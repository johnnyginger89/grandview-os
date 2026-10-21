import { expect, test, type Page } from "@playwright/test";
import { expectNoAccess, statePath } from "./helpers";
import { sellThreeThousandDollarJob } from "./sales";

/*
 * The short menu, the Jobs/Home tabs and the one search box (UX step 1).
 * One customer and one sold job are created up front and searched for throughout.
 */
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const CUSTOMER = `Searchable ${stamp} [TEST DATA]`;
const STREET = `${String(stamp).slice(-5)} Lookup Lane`;
const PHONE = `604-555-${String(stamp).slice(-4)}`;
let soldName = "";
let soldNumber = "";

const search = (page: Page) => page.getByRole("combobox", { name: "Search" });
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.describe("navigation and search (owner, desktop)", () => {
  test.use({ storageState: statePath("owner") });

  test("the menu is short and named after the work", async ({ page }) => {
    await page.goto("/");
    const nav = mainNav(page);
    for (const name of ["Home", "Jobs", "Schedule", "Customers", "Rates"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    for (const old of ["Dashboard", "Performance", "Leads & Pipeline", "Estimates", "Projects", "Rate Library"]) await expect(nav.getByRole("link", { name: old, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");

    const homeTabs = page.getByRole("navigation", { name: "Home" });
    await homeTabs.getByRole("link", { name: "Performance" }).click();
    await expect(page).toHaveURL(/\/performance$/);
    await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("Jobs holds leads, estimates and sold jobs, and remembers the last tab", async ({ page }) => {
    await page.goto("/leads");
    const tabs = page.getByRole("navigation", { name: "Jobs" });
    await expect(tabs.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "Leads" })).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "Jobs", exact: true })).toHaveAttribute("aria-current", "page");

    // "/" goes to the page's own filter box here; Ctrl+K still opens the main search.
    await page.locator("body").click({ position: { x: 5, y: 400 } });
    await page.keyboard.press("/");
    await expect(page.getByRole("searchbox", { name: "Search leads" })).toBeFocused();
    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 5, y: 400 } });
    await page.keyboard.press("Control+k");
    await expect(search(page)).toBeFocused();
    await page.keyboard.press("Escape");

    await tabs.getByRole("link", { name: "Sold jobs" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sold jobs" })).toBeVisible();

    await mainNav(page).getByRole("link", { name: "Schedule", exact: true }).click();
    await expect(page).toHaveURL(/\/schedule/);
    await expect(mainNav(page).getByRole("link", { name: "Jobs", exact: true })).toHaveAttribute("href", "/projects");
    await mainNav(page).getByRole("link", { name: "Jobs", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);

    // Detail pages keep "Jobs" lit but drop the tabs.
    await page.goto("/estimates/new");
    await expect(mainNav(page).getByRole("link", { name: "Jobs", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Jobs" })).toHaveCount(0);
  });

  test("+ New opens the common add screens", async ({ page }) => {
    await page.goto("/customers");
    const menu = page.getByRole("group", { name: "New", exact: true });
    await page.getByRole("button", { name: "New", exact: true }).click();
    for (const name of ["New lead", "New customer", "New estimate"]) await expect(menu.getByRole("link", { name })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await menu.getByRole("link", { name: "New customer" }).click();
    await expect(page).toHaveURL(/\/customers\/new$/);

    // The customer the search tests look for.
    await page.getByLabel("Customer name").fill(CUSTOMER);
    await page.getByLabel("Email").fill(`search-${stamp}@example.com`);
    await page.getByLabel("Phone", { exact: true }).fill(PHONE);
    await page.getByLabel("Street address").fill(STREET);
    await page.getByLabel("City").fill("Surrey");
    await page.getByRole("button", { name: "Create customer" }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);

    // The customer list shows the city from the customer's address.
    await page.goto(`/customers?q=${encodeURIComponent(`Searchable ${stamp}`)}`);
    await expect(page.getByRole("row", { name: new RegExp(`Searchable ${stamp}`) })).toContainText("Surrey");
  });

  test("search finds a customer by name, street or phone and opens it from the keyboard", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("/");
    await expect(search(page)).toBeFocused();

    await search(page).fill(`searchable ${stamp}`);
    const option = page.getByRole("option", { name: new RegExp(`Searchable ${stamp}`) });
    await expect(option).toBeVisible();
    await expect(option).toContainText(`${STREET}, Surrey`);
    await expect(page.getByRole("group", { name: "Customers" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(option).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(CUSTOMER);
    await expect(search(page)).toHaveValue("");

    await search(page).fill(STREET.split(" ").slice(0, 2).join(" "));
    await expect(page.getByRole("option", { name: new RegExp(`Searchable ${stamp}`) })).toBeVisible();

    await search(page).fill(PHONE.replace(/-/g, " "));
    await expect(page.getByRole("option", { name: new RegExp(`Searchable ${stamp}`) })).toBeVisible();

    await search(page).fill(`nothing-like-this-${stamp}`);
    await expect(page.getByRole("listbox", { name: "Search results" }).getByText(/No matches for/)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=nothing-like-this/);
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  });

  test("search finds a sold job by its number and lists it before its estimate", async ({ page, browser }) => {
    soldName = await sellThreeThousandDollarJob(page, browser);
    await page.goto("/projects");
    await page.getByRole("link", { name: new RegExp(soldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("#");
    soldNumber = (await page.getByRole("heading", { level: 1 }).innerText()).match(/#(\d+)/)![1];

    await page.goto("/customers");
    await search(page).fill(`#${soldNumber}`);
    const first = page.getByRole("option").first();
    await expect(first).toContainText(`#${soldNumber}`);
    await expect(page.getByRole("group").first()).toHaveAccessibleName("Sold jobs");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

    // By name: the job and the customer, not the signed estimate or the won lead a second time.
    await search(page).fill(soldName.split(" ").slice(0, 3).join(" "));
    await expect(page.getByRole("group", { name: "Sold jobs" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Customers" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Estimates" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Leads" })).toHaveCount(0);
    expect(await page.getByRole("listbox", { name: "Search results" }).innerText()).not.toContain("$");
  });
});

test.describe("search for other roles", () => {
  test.describe("estimator", () => {
    test.use({ storageState: statePath("estimator") });
    test("finds customers and estimates but no sold jobs", async ({ page }) => {
      test.skip(!soldName, "needs the owner steps above");
      await page.goto("/leads");
      await search(page).fill(soldName.split(" ").slice(0, 3).join(" "));
      await expect(page.getByRole("group", { name: "Customers" })).toBeVisible();
      await expect(page.getByRole("group", { name: "Estimates" })).toBeVisible();
      await expect(page.getByRole("group", { name: "Sold jobs" })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Work orders" })).toHaveCount(0);
      const res = await page.request.get(`/api/search?q=${encodeURIComponent(`#${soldNumber}`)}`);
      expect(res.status()).toBe(200);
      expect(JSON.stringify(await res.json())).not.toContain(`/projects/`);
    });
  });

  test.describe("painter", () => {
    test.use({ storageState: statePath("painter") });
    test("has no search and can't call it directly", async ({ page }) => {
      await page.goto("/my-jobs");
      await expect(search(page)).toHaveCount(0);
      await expect(mainNav(page).getByRole("link", { name: "My Jobs" })).toBeVisible();
      const res = await page.request.get("/api/search?q=test");
      expect(res.status()).toBe(403);
      await expectNoAccess(page, "/search?q=test");
    });
  });

  test.describe("signed out", () => {
    test("the search API refuses anonymous requests", async ({ browser }) => {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const res = await context.request.get("/api/search?q=test");
      expect(res.status()).toBe(401);
      expect(res.headers()["cache-control"]).toContain("no-store");
      await context.close();
    });
  });
});

test.describe("phone navigation (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("bottom bar, search sheet and More @mobile", async ({ page }) => {
    await page.goto("/");
    const bar = mainNav(page);
    for (const name of ["Home", "Jobs", "Schedule"]) await expect(bar.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Search" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "More" })).toBeVisible();

    // The "+" button sits above the bar, not under it.
    const plus = await page.getByRole("button", { name: "Add", exact: true }).boundingBox();
    const barBox = await bar.boundingBox();
    expect(plus!.y + plus!.height).toBeLessThanOrEqual(barBox!.y);

    await bar.getByRole("button", { name: "Search" }).click();
    const sheet = page.getByRole("dialog", { name: "Search" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("combobox", { name: "Search" })).toBeFocused();
    await sheet.getByRole("combobox", { name: "Search" }).fill(soldName ? soldName.split(" ").slice(0, 3).join(" ") : "test data");
    await sheet.getByRole("option").first().click();
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/\/$/);

    await bar.getByRole("button", { name: "More" }).click();
    const more = page.getByRole("dialog", { name: "More" });
    for (const name of ["Customers", "Rates", "Settings"]) await expect(more.getByRole("link", { name })).toBeVisible();
    await more.getByRole("link", { name: "Customers" }).click();
    await expect(page).toHaveURL(/\/customers$/);
    await expect(more).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});

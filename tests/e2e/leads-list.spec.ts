import { expect, test, type Page } from "@playwright/test";
import { expectNoAccess, statePath } from "./helpers";

async function newLead(page: Page, last: string) {
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("List");
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Email").fill(`${last.replace(/\W+/g, "-").toLowerCase()}@example.com`);
  await page.getByText("Interior", { exact: true }).click();
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  return `List ${last}`;
}

test.describe("leads list (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("toggles between board and list and remembers the choice", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List", exact: true }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page.getByRole("table")).toBeVisible();
    await page.goto("/leads");
    await expect(page.getByRole("table")).toBeVisible();
    await page.goto("/leads?view=board");
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Board", exact: true }).click();
  });

  test("inline stage change with undo, and a bulk move", async ({ page }) => {
    const stamp = Date.now();
    const a = await newLead(page, `A ${stamp}`);
    const b = await newLead(page, `B ${stamp}`);
    await page.goto("/leads?view=list");
    await page.getByRole("searchbox", { name: "Search leads" }).fill(String(stamp));
    const table = page.getByRole("table");

    await table.getByRole("combobox", { name: `Stage for ${a}` }).selectOption({ label: "Contacted" });
    const toast = page.getByTestId("leads-toast");
    await expect(toast).toContainText(`Moved ${a} to Contacted`);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toContainText(`Moved ${a} back to`);

    await table.getByRole("checkbox", { name: `Select ${a}` }).check();
    await table.getByRole("checkbox", { name: `Select ${b}` }).check();
    const bulk = page.getByRole("region", { name: "Bulk actions" });
    await expect(bulk.getByTestId("bulk-count")).toHaveText("2 selected");
    await bulk.getByLabel("Move to").selectOption({ label: "Contacted" });
    await bulk.getByRole("button", { name: "Apply" }).click();
    await expect(toast).toContainText("2 leads moved");
    await page.reload();
    await expect(table.getByRole("combobox", { name: `Stage for ${b}` })).toHaveValue(await table.getByRole("combobox", { name: `Stage for ${b}` }).locator("option", { hasText: "Contacted" }).getAttribute("value") ?? "");
  });

  test("phones get cards with call and email buttons @mobile", async ({ page }) => {
    await page.goto("/leads?view=list");
    const card = page.getByTestId("lead-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByRole("link", { name: "Call" }).or(card.getByRole("link", { name: "Email" })).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("leads list (field roles)", () => {
  test.use({ storageState: statePath("painter") });
  test("painters can't open it", async ({ page }) => {
    await expectNoAccess(page, "/leads?view=list");
  });
});

test.describe("phone home screen", () => {
  test.use({ storageState: statePath("owner") });
  test("shows the tile menu and the add button @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("jobs-today")).toContainText("today");
    const menu = page.getByRole("region", { name: "Menu" });
    for (const label of ["Leads", "Estimates", "Customers", "Sold jobs"]) await expect(menu.getByRole("link", { name: new RegExp(label) })).toBeVisible();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add lead" }).click();
    await expect(page).toHaveURL(/\/leads\/new/);
  });
});

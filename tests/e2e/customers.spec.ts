import { expect, test, type Page } from "@playwright/test";
import { statePath } from "./helpers";
import { draftThreeThousandDollarEstimate, sellThreeThousandDollarJob } from "./sales";

/*
 * Correcting a customer (audit A-SAL-8, A-PRD-13): "Edit customer" changes the email the
 * app sends to, contacts and properties are edited and removed in proper dialogs, a
 * property in use can't be removed, and a property built before 1990 warns the crew on
 * My Jobs. The steps share customers, so the file runs in order.
 */
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const FIXED = `fixed-${stamp}@example.com`;
const LEE = `lee-${stamp}@example.com`;
const CREW = `[TEST DATA] Old homes ${stamp}`;
const WARNING = "Built before 1990: assume lead paint and asbestos may be present. Follow safe work practices.";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let customerPath = "";
let estimatePath = "";
let projectNumber = "";
let startDate = "";

const contactsCard = (page: Page) => page.getByRole("region", { name: "Contacts" });
const propertiesCard = (page: Page) => page.getByRole("region", { name: "Properties" });

/** A Monday about three weeks out, YYYY-MM-DD (a day either way doesn't matter here). */
function futureMonday(): string {
  const d = new Date(Date.now() + 21 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

test.describe("customer details (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("Edit customer is a real dialog, and its email is where the proposal goes", async ({ page }) => {
    const name = await draftThreeThousandDollarEstimate(page);
    estimatePath = new URL(page.url()).pathname;
    await page.getByRole("link", { name, exact: true }).first().click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    customerPath = new URL(page.url()).pathname;

    const open = page.getByRole("button", { name: "Edit customer" });
    const dialog = page.getByRole("dialog", { name: "Edit customer" });
    await open.click();
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();

    await open.click();
    await expect(dialog.getByLabel("Email")).toHaveValue(/^sale-\d+@example\.com$/);
    await dialog.getByLabel("Email").fill(FIXED);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(contactsCard(page).getByRole("link", { name: FIXED })).toBeVisible();

    await page.goto(estimatePath);
    await page.getByRole("button", { name: "Send proposal" }).click();
    await expect(page.getByLabel("Customer email")).toHaveValue(FIXED);
  });

  test("contacts are edited, made primary and removed, and the email follows the primary", async ({ page }) => {
    test.skip(!customerPath, "needs the customer above");
    await page.goto(customerPath);
    const card = contactsCard(page);

    // The contact made with the customer had an email but no name.
    await card.getByRole("button", { name: `Edit ${FIXED}` }).click();
    const edit = page.getByRole("dialog", { name: "Edit contact" });
    await expect(edit.getByLabel("Email")).toHaveValue(FIXED);
    await edit.getByLabel("First name").fill("[TEST DATA] Kim");
    await edit.getByLabel("Last name").fill("Lee");
    await edit.getByLabel("Phone", { exact: true }).fill("604-555-0100");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();
    const kim = card.getByRole("listitem").filter({ hasText: "[TEST DATA] Kim Lee" });
    await expect(kim).toContainText("Primary");
    await expect(kim).toContainText("604-555-0100");

    await card.getByRole("button", { name: "+ Add contact" }).click();
    const add = page.getByRole("dialog", { name: "Add contact" });
    await add.getByLabel("First name").fill("[TEST DATA] Lee");
    await add.getByLabel("Email").fill(LEE);
    await add.getByRole("button", { name: "Add contact" }).click();
    await expect(add).toBeHidden();
    const lee = card.getByRole("listitem").filter({ hasText: LEE });
    await expect(lee).toBeVisible();
    await expect(lee.getByText("Primary", { exact: true })).toHaveCount(0);

    await lee.getByRole("button", { name: "Make [TEST DATA] Lee primary" }).click();
    const make = page.getByRole("dialog", { name: "Make [TEST DATA] Lee the primary contact?" });
    await expect(make).toContainText(`Emails from the app will go to ${LEE}.`);
    await make.getByRole("button", { name: "Make primary" }).click();
    await expect(make).toBeHidden();
    await expect(lee.getByText("Primary", { exact: true })).toBeVisible();
    await expect(kim.getByText("Primary", { exact: true })).toHaveCount(0);

    // One place for the email: Edit customer now shows the new primary's.
    await page.getByRole("button", { name: "Edit customer" }).click();
    await expect(page.getByRole("dialog", { name: "Edit customer" }).getByLabel("Email")).toHaveValue(LEE);
    await page.keyboard.press("Escape");

    // Removing the primary asks who takes over.
    await lee.getByRole("button", { name: "Remove [TEST DATA] Lee" }).click();
    const remove = page.getByRole("dialog", { name: "Remove [TEST DATA] Lee?" });
    await expect(remove.getByLabel("New primary contact").locator("option:checked")).toHaveText("[TEST DATA] Kim Lee");
    await remove.getByRole("button", { name: "Remove contact" }).click();
    await expect(remove).toBeHidden();
    await expect(card.getByText(LEE)).toHaveCount(0);
    await expect(kim.getByText("Primary", { exact: true })).toBeVisible();
    await expect(kim).toContainText(FIXED);

    // The customer list shows (and finds) the same email.
    await page.goto(`/customers?q=${encodeURIComponent(FIXED)}`);
    await expect(page.getByRole("row").filter({ hasText: "[TEST DATA]" })).toContainText(FIXED);
    await page.goto(`/customers?q=${encodeURIComponent(LEE)}`);
    await expect(page.getByText("No customers match that search")).toBeVisible();
  });

  test("a property is edited, and can't be removed while an estimate uses it", async ({ page }) => {
    test.skip(!customerPath, "needs the customer above");
    await page.goto(customerPath);
    const card = propertiesCard(page);

    await card.getByRole("button", { name: "Remove 1 Example St" }).click();
    const remove = page.getByRole("dialog", { name: "Remove this property?" });
    await expect(remove.getByRole("button", { name: "Cancel" })).toBeFocused();
    await remove.getByRole("button", { name: "Remove property" }).click();
    await expect(remove.getByRole("alert")).toHaveText(/^This property is used by estimate #\d+, so it can't be removed\. You can edit it instead\.$/);
    await remove.getByRole("button", { name: "Cancel" }).click();
    await expect(remove).toBeHidden();

    await card.getByRole("button", { name: "Edit 1 Example St" }).click();
    const edit = page.getByRole("dialog", { name: "Edit property" });
    await expect(edit.getByLabel("Street address")).toBeFocused();
    await edit.getByLabel("Unit").fill("4");
    await edit.getByLabel("City").fill("Surrey");
    await edit.getByLabel("Province").selectOption("BC");
    await edit.getByLabel("Postal code").fill("v3s0a1");
    await edit.getByLabel("Access notes").fill("Lockbox 2468 by the side door");
    await edit.getByLabel("Built before 1990").check();
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();
    await expect(card.getByRole("link", { name: "4 – 1 Example St, Surrey, BC V3S 0A1" })).toBeVisible();
    await expect(card.getByText("Built before 1990")).toBeVisible();
    await expect(card.getByText("Lockbox 2468 by the side door")).toBeVisible();

    // An unused property can go.
    await card.getByRole("button", { name: "+ Add property" }).click();
    const add = page.getByRole("dialog", { name: "Add property" });
    await add.getByLabel("Street address").fill("9 Example Ave");
    await add.getByRole("button", { name: "Add property" }).click();
    await expect(add).toBeHidden();
    await card.getByRole("button", { name: "Remove 9 Example Ave" }).click();
    await page.getByRole("dialog", { name: "Remove this property?" }).getByRole("button", { name: "Remove property" }).click();
    await expect(card.getByText("9 Example Ave")).toHaveCount(0);
  });

  test("a sold job at a pre-1990 property is booked for a crew", async ({ page, browser }) => {
    test.slow();
    const name = await sellThreeThousandDollarJob(page, browser);
    await page.goto("/projects");
    const projectPath = (await page.getByRole("link", { name: new RegExp(escape(name)) }).first().getAttribute("href"))!;
    expect(projectPath).toMatch(/^\/projects\/[0-9a-f-]{36}$/);
    await page.goto(projectPath);
    projectNumber = (await page.getByRole("heading", { level: 1 }).innerText()).match(/#(\d+)/)![1];

    await page.goto((await page.getByRole("link", { name, exact: true }).getAttribute("href"))!);
    await propertiesCard(page).getByRole("button", { name: "Edit 1 Example St" }).click();
    const edit = page.getByRole("dialog", { name: "Edit property" });
    await edit.getByLabel("Built before 1990").check();
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(propertiesCard(page).getByText("Built before 1990")).toBeVisible();

    await page.goto("/schedule/setup");
    await page.getByRole("button", { name: "Add crew" }).click();
    const crew = page.getByRole("form", { name: "Add crew" });
    await crew.getByLabel("Name").fill(CREW);
    await crew.getByLabel("Type").selectOption({ label: "Subcontractor" });
    await crew.getByLabel("Crew size").fill("2");
    await crew.getByLabel("Hours per day").fill("8");
    await crew.getByRole("checkbox", { name: "Subcontractor (Dev)" }).check();
    await crew.getByRole("button", { name: "Crew lead: Subcontractor (Dev)" }).click();
    await crew.getByRole("button", { name: "Save crew" }).click();
    await expect(page.getByRole("table", { name: "Crews" }).getByText(CREW).first()).toBeVisible();

    await page.goto(projectPath);
    await page.getByRole("button", { name: "Schedule this job" }).click();
    const book = page.getByRole("form", { name: "Schedule this job" });
    await book.getByLabel("Crew").selectOption({ label: CREW });
    startDate = futureMonday();
    await book.getByLabel("Start date").fill(startDate);
    await book.getByLabel("Working days").fill("1");
    await book.getByRole("button", { name: "Add to schedule" }).click();
    await expect(page.getByRole("status").filter({ hasText: /./ }).first()).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("table", { name: "Bookings" }).getByText(CREW)).toBeVisible();
  });
});

test.describe("the crew (subcontractor lead)", () => {
  test.use({ storageState: statePath("subcontractor") });

  test("My Jobs warns about lead paint and asbestos", async ({ page }) => {
    test.skip(!projectNumber, "needs the owner steps above");
    await page.goto("/my-jobs");
    const job = page.getByRole("article").filter({ hasText: `#${projectNumber}` });
    await expect(job).toBeVisible();
    await expect(job.getByText(WARNING)).toBeVisible();
  });
});

test.describe("cleanup (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("remove the booking and turn the test crew off", async ({ page }) => {
    test.skip(!startDate, "needs the owner steps above");
    await page.goto(`/schedule?view=timeline&from=${startDate}&span=14`);
    // Retry until the page has loaded enough to open the drawer.
    await expect(async () => {
      await page.getByRole("button", { name: new RegExp(`Job #${projectNumber}\\b`) }).first().click();
      await expect(page.getByTestId("entry-drawer")).toBeVisible({ timeout: 2_000 });
    }).toPass();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("entry-drawer").getByRole("button", { name: "Remove from schedule" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`Job #${projectNumber}\\b`) })).toHaveCount(0);

    await page.goto("/schedule/setup");
    const active = page.getByRole("switch", { name: `Active: ${CREW}` });
    await active.click();
    await expect(active).toHaveAttribute("aria-checked", "false");
  });
});

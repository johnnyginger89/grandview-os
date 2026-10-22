import { expect, test, type Page } from "@playwright/test";
import { statePath } from "./helpers";
import { sellThreeThousandDollarJob } from "./sales";

/*
 * Long lists show 100 at a time with a count and Previous / Next, instead of quietly
 * stopping (customers used to stop at 200, estimates and jobs at 300). 105 customers are
 * imported on one made-up street, found on the Customers list by that street, paged through
 * with the search and filter kept, and the import is undone at the end.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: statePath("owner") });

const stamp = Date.now();
/** One word only these customers' addresses contain (not their names or emails). */
const STREET = `Pagewood${stamp}`;
const COUNT = 105;
let batchUrl = "";

const pager = (page: Page) => page.getByRole("navigation", { name: "Pages" });
const customerRows = (page: Page) => page.getByRole("row").filter({ hasText: "Paging Person" });
const namesOn = async (page: Page) => (await customerRows(page).allInnerTexts()).map((t) => t.match(/Paging Person \d{3}/)![0]);
const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key);

test.afterAll(async ({ browser }) => {
  if (!batchUrl) return;
  const context = await browser.newContext({ storageState: statePath("owner") });
  const page = await context.newPage();
  await page.goto(batchUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Undo this import" }).click();
  await expect(page.getByText(new RegExp(`Undone\\. ${COUNT} customers removed`))).toBeVisible({ timeout: 30_000 });
  await context.close();
});

test("import 105 customers on one street", async ({ page }) => {
  // Previewing and importing 105 rows takes a few seconds on a busy machine.
  test.slow();
  const csv = [
    "Customer ID,Display Name,Email,Street,City,Province",
    ...Array.from({ length: COUNT }, (_, i) => `PG${stamp}-${i},Paging Person ${String(i + 1).padStart(3, "0")} [TEST DATA],paging-${stamp}-${i}@example.com,${i + 1} ${STREET} Rd,Surrey,BC`),
  ].join("\n");
  await page.goto("/settings/import");
  await page.getByLabel("Markate customer export (CSV)").setInputFiles({ name: `paging-${stamp}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await expect(page).toHaveURL(/\/settings\/import\/[0-9a-f-]{36}/, { timeout: 30_000 });
  batchUrl = page.url();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: `Import ${COUNT} new · update 0` }).click();
  await expect(page.getByText("Imported", { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("the Customers list finds them by street and pages through all of them", async ({ page }) => {
  await page.goto("/customers");
  const box = page.getByRole("textbox", { name: "Search customers" });
  await expect(box).toHaveAttribute("placeholder", /address/);
  await box.fill(STREET);
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`q=${STREET}`));
  await expect(pager(page)).toContainText(`Showing 1–100 of ${COUNT}`);
  await expect(customerRows(page)).toHaveCount(100);
  await expect(pager(page).getByText("Previous")).toHaveAttribute("aria-disabled", "true");
  const first = await namesOn(page);

  // Next, from the bottom of the list, opens the top of page 2 with the search kept.
  await pager(page).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(param(page, "q")).toBe(STREET);
  await expect(pager(page)).toContainText(`Showing 101–105 of ${COUNT}`);
  await expect(customerRows(page)).toHaveCount(COUNT - 100);
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeInViewport();
  await expect(pager(page).getByText("Next")).toHaveAttribute("aria-disabled", "true");
  await expect(box).toHaveValue(STREET);

  // Every customer once: none on both pages, none missing.
  const second = await namesOn(page);
  expect(new Set([...first, ...second]).size).toBe(COUNT);

  await pager(page).getByRole("link", { name: "Previous" }).click();
  await expect(pager(page)).toContainText(`Showing 1–100 of ${COUNT}`);
  expect(param(page, "page")).toBeNull();
  expect(param(page, "q")).toBe(STREET);
});

test("a filter starts again at page 1 and paging keeps it", async ({ page }) => {
  await page.goto(`/customers?q=${STREET}&page=2`);
  await page.getByRole("link", { name: "Residential", exact: true }).click();
  await expect(page).toHaveURL(/type=residential/);
  expect(param(page, "page")).toBeNull();
  await expect(pager(page)).toContainText(`Showing 1–100 of ${COUNT}`);

  await pager(page).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(param(page, "type")).toBe("residential");
  expect(param(page, "q")).toBe(STREET);
  await expect(customerRows(page)).toHaveCount(COUNT - 100);

  // Searching again keeps the filter and starts at page 1.
  const box = page.getByRole("textbox", { name: "Search customers" });
  await box.fill(`${STREET} Rd`);
  await box.press("Enter");
  await expect(page).toHaveURL(/q=/);
  expect(param(page, "type")).toBe("residential");
  expect(param(page, "page")).toBeNull();
  await expect(pager(page)).toContainText(`Showing 1–100 of ${COUNT}`);

  await page.goto(`/customers?q=${STREET}&type=commercial`);
  await expect(page.getByText("No customers match that search")).toBeVisible();
  await expect(pager(page)).toHaveCount(0);
});

test("an old link past the end shows the last page", async ({ page }) => {
  await page.goto(`/customers?q=${STREET}&page=9`);
  await expect(pager(page)).toContainText(`Showing 101–105 of ${COUNT}`);
  await expect(customerRows(page)).toHaveCount(COUNT - 100);
});

test("estimates, jobs and work orders say how many there are", async ({ page, browser }) => {
  // Selling a job from scratch (customer, estimate, proposal, signature) is most of this test.
  test.slow();
  const name = await sellThreeThousandDollarJob(page, browser);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const count = /^Showing 1(–[\d,]+)? of [\d,]+$/;

  await page.goto("/estimates?status=accepted&page=999");
  await expect(page.getByRole("link", { name: new RegExp(escaped) })).toBeVisible();
  await expect(pager(page).locator("p")).toHaveText(count);
  expect(param(page, "status")).toBe("accepted");

  await page.goto(`/estimates?q=${encodeURIComponent(name.split(" ").slice(0, 3).join(" "))}`);
  await expect(pager(page)).toContainText("Showing 1 of 1");

  await page.goto("/projects?page=999");
  await expect(page.getByRole("link", { name: new RegExp(escaped) }).first()).toBeVisible();
  await expect(pager(page).locator("p")).toHaveText(count);

  await page.goto("/work-orders?status=draft&page=999");
  await expect(page.getByTestId("work-order-row").filter({ hasText: name })).toHaveCount(1);
  await expect(pager(page).locator("p")).toHaveText(count);
});

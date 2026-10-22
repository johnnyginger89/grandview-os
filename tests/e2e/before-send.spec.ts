import { expect, test, type Page } from "@playwright/test";
import { statePath } from "./helpers";
import { addRoom, startBlankEstimate } from "./sales";

/*
 * Before a proposal goes out (audit A-EST-14, A-EST-9): the job address is picked on the
 * estimate and required, and surfaces priced at $0 are sent only when that's meant.
 */
test.use({ storageState: statePath("owner") });

async function newCustomer(page: Page, label: string, street?: string) {
  const stamp = Date.now();
  await page.goto("/customers/new");
  await page.getByLabel("Customer name").fill(`${label} ${stamp} [TEST DATA]`);
  if (street) await page.getByLabel("Street address").fill(street);
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
}

test("the job address is picked on the estimate, and nothing is sent without one", async ({ page }) => {
  await newCustomer(page, "Landlord");
  await page.getByRole("link", { name: "New estimate" }).click();
  await startBlankEstimate(page);
  await addRoom(page, "Living room", { size: "15 12 8", only: ["Walls – roll & cut"] });
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  const estimateUrl = page.url();

  // No address on file: the estimate says so, and Send can't go ahead.
  await expect(page.getByText("No job address.")).toBeVisible();
  await page.getByRole("button", { name: "Send proposal" }).click();
  const dialog = page.getByRole("dialog", { name: "Send proposal" });
  await expect(dialog.getByRole("alert")).toContainText("Pick the job address at the top of the estimate first.");
  await dialog.getByText("Email it to the customer").click();
  await expect(dialog.getByRole("button", { name: "Create link" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Two rentals on the customer's file; the job is at the second one.
  await page.getByRole("link", { name: "Add one on the customer's page" }).click();
  const card = page.getByRole("region", { name: "Properties" });
  for (const street of ["10 Rental Rd", "20 Rental Rd"]) {
    await card.getByRole("button", { name: "+ Add property" }).click();
    const add = page.getByRole("dialog", { name: "Add property" });
    await add.getByLabel("Street address").fill(street);
    await add.getByRole("button", { name: "Add property" }).click();
    await expect(add).toBeHidden();
  }
  await page.goto(estimateUrl);
  // Addresses read as the app writes them (province BC unless typed otherwise).
  await page.getByLabel("Job address").selectOption({ label: "20 Rental Rd, BC" });
  await page.getByRole("button", { name: "Use this address" }).click();
  await expect(page.getByText("20 Rental Rd")).toBeVisible();
  await expect(page.getByLabel("Job address")).toHaveCount(0);

  // It's what the customer sees, and the editor carries on saving afterwards.
  await page.getByLabel("Estimate title").fill("Rental repaint [TEST DATA]");
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Send proposal" }).click();
  await dialog.getByText("Email it to the customer").click();
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = await dialog.getByLabel("Proposal link").inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  const customer = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  const cp = await customer.newPage();
  await cp.goto(link);
  await expect(cp.getByText(/20 Rental Rd/).first()).toBeVisible();
  await expect(cp.getByText(/10 Rental Rd/)).toHaveCount(0);
  await customer.close();

  // Changing it later: Change, pick, Save.
  await page.reload();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  const picker = page.getByLabel("Job address");
  await picker.selectOption({ label: "10 Rental Rd, BC" });
  await picker.locator("..").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("10 Rental Rd")).toBeVisible();
  await expect(page.getByText("The customer still sees the version sent on")).toBeVisible();
});

test("surfaces with no price are listed before sending, and go out only when that's meant", async ({ page }) => {
  await newCustomer(page, "Unmeasured", "1 Example St");
  await page.getByRole("link", { name: "New estimate" }).click();
  await startBlankEstimate(page);
  await addRoom(page, "Living room", { size: "15 12 8", only: ["Walls – roll & cut"] });
  // A second room added before it was measured.
  await addRoom(page, "Hallway", { only: ["Walls – roll & cut"] });
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Send proposal" }).click();
  const dialog = page.getByRole("dialog", { name: "Send proposal" });
  const warning = dialog.getByRole("group", { name: "Surfaces with no price" });
  await expect(warning).toContainText("This surface has no price yet, so the customer would see the work promised for $0:");
  await expect(warning.getByRole("listitem")).toHaveText(["Hallway – Walls – roll & cut"]);
  await dialog.getByText("Email it to the customer").click();
  const create = dialog.getByRole("button", { name: "Create link" });
  await expect(create).toBeDisabled();
  await warning.getByLabel("It's meant: send anyway").check();
  await create.click();
  await expect(dialog.getByLabel("Proposal link")).toBeVisible();
});

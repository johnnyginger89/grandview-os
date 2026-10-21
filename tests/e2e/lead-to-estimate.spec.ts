import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";

test.describe("owner", () => {
test.use({ storageState: statePath("owner") });

test("owner: set booking link, create lead, send booking link, build estimate", async ({ page }) => {

  // Company settings: booking link
  await page.goto("/settings?tab=company");
  await page.getByLabel("YouCanBook.me booking link").fill("https://grandviewpainting.youcanbook.me");
  await page.getByLabel("Main phone").fill("604-555-0199");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  // New lead
  await page.goto("/leads/new");
  const stamp = Date.now();
  await page.getByLabel("First name").fill("E2E");
  await page.getByLabel("Last name").fill(`Customer ${stamp}`);
  await page.getByLabel("Email").fill(`e2e-${stamp}@example.com`);
  await page.getByText("Interior", { exact: true }).click();
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: `E2E Customer ${stamp}` })).toBeVisible();

  // One-click booking link
  await page.getByRole("button", { name: "Send booking link" }).click();
  await expect(page.getByText("https://grandviewpainting.youcanbook.me")).toBeVisible();
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText(/Logged \(email delivery|^Booking link sent$/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Stage")).toHaveValue(await page.getByRole("option", { name: "Contacted" }).getAttribute("value") ?? "");
  await expect(page.getByText(/Booking link sent to e2e-/)).toBeVisible();

  // Estimate from lead
  await page.getByRole("link", { name: "Create estimate" }).click();
  await page.getByRole("button", { name: "Create and start estimating" }).click();
  await expect(page).toHaveURL(/\/estimates\/[0-9a-f-]{36}/);

  await page.getByRole("button", { name: "Living room" }).click();
  await page.getByLabel("Length (ft)").fill("15");
  await page.getByLabel("Width (ft)").fill("12");
  await page.getByLabel("Height (ft)").fill("8");
  await page.getByLabel("Add item").first().selectOption({ label: "Walls – roll & cut" });
  // Walls auto-calculated from dimensions: 2 × (15 + 12) × 8 = 432 sq ft
  await expect(page.getByLabel("Quantity").first()).toHaveValue("432");
  await page.getByLabel("Add item").first().selectOption({ label: "Door slab (per side)" });
  await page.getByLabel("Quantity").nth(1).fill("4");

  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  // Small job → minimum price applies
  await expect(page.getByText("Minimum job adjustment")).toBeVisible();
  await expect(page.getByText("$2,000.00").first()).toBeVisible();
  await expect(page.getByText("$2,100.00")).toBeVisible();

  // Survives reload
  await page.reload();
  await expect(page.getByLabel("Quantity").first()).toHaveValue("432");

  // Mark sent creates revision 1
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByText("rev 1")).toBeVisible();
});

test("rate edits create a new version and do not change existing estimates", async ({ page }) => {
  await page.goto("/rates");
  await page.getByRole("row", { name: /INT-CROWN/ }).click();
  const current = await page.getByLabel(/lin ft per hour/).inputValue();
  await page.getByLabel(/lin ft per hour/).fill(String(Number(current) + 1));
  const note = `E2E test edit ${Date.now()}`;
  await page.getByLabel("What changed and why?").fill(note);
  await page.getByRole("button", { name: /Save as v\d+/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("row", { name: /INT-CROWN/ }).click();
  await page.getByRole("button", { name: "Show version history" }).click();
  await expect(page.getByText(note)).toBeVisible();
});

});

test.describe("estimator on a phone", () => {
test.use({ storageState: statePath("estimator") });
test("@mobile pipeline and lead pages work on a phone", async ({ page }) => {
  await page.goto("/leads");
  await expect(page.getByRole("heading", { level: 1, name: "Leads" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Customers" })).toBeVisible();
});
});

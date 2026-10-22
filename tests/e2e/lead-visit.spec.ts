import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";

/* A visit agreed by phone is booked on the lead and counts like an online booking (audit A-SAL-12). */
test.use({ storageState: statePath("owner") });

test("the office books and moves the estimate visit on the lead", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Visit");
  await page.getByLabel("Last name").fill(`Booked ${stamp}`);
  await page.getByLabel("Phone").fill("604-555-0123");
  await page.getByText("Exterior", { exact: true }).click();
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  await expect(page.getByText("Not booked")).toBeVisible();

  await page.getByRole("button", { name: "Book visit" }).click();
  await page.getByLabel("Visit date and time").fill("2026-11-05T10:00");
  await page.getByRole("button", { name: "Book visit" }).click();
  await expect(page.getByText(/^Nov 5, 2026, 10:00/).first()).toBeVisible();
  await expect(page.getByLabel("Stage").locator("option:checked")).toHaveText("Estimate Booked");
  await expect(page.getByText(/Estimate visit booked for Nov 5, 2026, 10:00/)).toBeVisible();

  // The customer called back: same visit, later in the day. The time box starts on the booked time.
  await page.getByRole("button", { name: "Reschedule" }).click();
  await expect(page.getByLabel("Visit date and time")).toHaveValue("2026-11-05T10:00");
  await page.getByLabel("Visit date and time").fill("2026-11-05T14:30");
  await page.getByRole("button", { name: "Move visit" }).click();
  await expect(page.getByText(/Estimate visit moved to Nov 5, 2026, 2:30/)).toBeVisible();
});

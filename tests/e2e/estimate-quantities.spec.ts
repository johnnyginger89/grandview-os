import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";
import { addRoom, startBlankEstimate } from "./sales";

/*
 * A surface added before the room size is typed used to stay at 0 sq ft for good.
 * It now follows the room size, and typing a number over it sets it by hand.
 */
test.use({ storageState: statePath("owner") });

test("surfaces follow the room size, even when it's typed later, and can be typed over", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/customers/new");
  await page.getByLabel("Customer name").fill(`Quantities ${stamp} [TEST DATA]`);
  await page.getByRole("button", { name: "Create customer" }).click();
  await page.getByRole("link", { name: "New estimate" }).click();
  await startBlankEstimate(page);

  // Room and surface first, size last.
  await addRoom(page, "Living room", { only: ["Walls – roll & cut"] });
  const qty = page.getByLabel("Quantity", { exact: true }).first();
  await expect(qty).toHaveValue("0");
  await page.getByLabel("Length (ft)").fill("15");
  await page.getByLabel("Width (ft)").fill("12");
  // Walls: 2 × (15 + 12) × 8 ft high = 432 sq ft.
  await expect(qty).toHaveValue("432");

  // Typing over it sets the number by hand, and it no longer follows the room.
  await qty.fill("400");
  await qty.blur();
  await expect(qty).toHaveValue("400");
  await page.getByLabel("Length (ft)").fill("20");
  await expect(qty).toHaveValue("400");

  // And can go back to following the room size.
  await page.getByRole("button", { name: "Use the room size again" }).click();
  // 2 × (20 + 12) × 8 = 512.
  await expect(qty).toHaveValue("512");

  // Sums work in the quantity box.
  await qty.fill("12*8+10*8");
  await qty.press("Enter");
  await expect(qty).toHaveValue("176");
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
});

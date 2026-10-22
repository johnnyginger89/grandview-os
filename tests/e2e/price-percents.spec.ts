import { expect, test, type Page } from "@playwright/test";
import { statePath } from "./helpers";
import { draftThreeThousandDollarEstimate } from "./sales";

/*
 * The percent boxes on an estimate's Price tab (paint markup, target margin, deposit) show
 * plain numbers, never float noise like 56.99999999999999, round to hundredths of a percent,
 * stay inside their limits, and save so the estimate reloads the same.
 */
test.use({ storageState: statePath("owner") });

const saved = (page: Page) => expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });

async function openPriceTab(page: Page) {
  await page.getByRole("tab", { name: "Price" }).click();
  return {
    markup: page.getByLabel("Material markup percent"),
    margin: page.getByLabel("Target margin percent"),
    deposit: page.getByLabel("Deposit percent"),
    method: page.getByLabel("Method", { exact: true }),
  };
}

test("percent boxes show clean numbers, keep to their limits and save", async ({ page }) => {
  await draftThreeThousandDollarEstimate(page);
  let tab = await openPriceTab(page);
  await expect(tab.markup).toHaveValue("20");
  await expect(tab.deposit).toHaveValue("20");

  // 0.57 × 100 is 56.99999999999999 in floating point.
  await tab.markup.fill("57");
  await tab.deposit.fill("14.255");
  await tab.deposit.press("Tab");
  await expect(tab.markup).toHaveValue("57");
  await expect(tab.deposit).toHaveValue("14.26");
  await expect(page.getByText("Deposit (14%)")).toBeVisible();
  await saved(page);

  await page.reload();
  tab = await openPriceTab(page);
  await expect(tab.markup).toHaveValue("57");
  await expect(tab.deposit).toHaveValue("14.26");

  // Paint markup and deposit stop at 100%, the target margin at 95%.
  await tab.markup.fill("150");
  await tab.deposit.fill("120");
  await tab.deposit.press("Tab");
  await expect(tab.markup).toHaveValue("100");
  await expect(tab.deposit).toHaveValue("100");
  await tab.method.selectOption("target_margin");
  await tab.margin.fill("96");
  await tab.margin.press("Tab");
  await expect(tab.margin).toHaveValue("95");
  // 0.55 × 100 is 55.00000000000001 in floating point.
  await tab.margin.fill("55");
  await tab.margin.press("Tab");
  await expect(tab.margin).toHaveValue("55");
  await saved(page);
  await expect(page.getByText("Save failed")).toHaveCount(0);

  await page.reload();
  tab = await openPriceTab(page);
  await expect(tab.margin).toHaveValue("55");
  await expect(tab.deposit).toHaveValue("100");
});

import { expect, test } from "@playwright/test";
import { expectNoAccess, statePath } from "./helpers";

test.describe("Markate import", () => {
  test.use({ storageState: statePath("owner") });

  test("preview, import and undo a customer export", async ({ page }) => {
    const stamp = Date.now();
    // An existing customer the file should match by email instead of duplicating.
    await page.goto("/customers/new");
    await page.getByLabel("Customer name").fill(`Existing Import ${stamp} [TEST DATA]`);
    await page.getByLabel("Email").fill(`existing-${stamp}@example.com`);
    await page.getByRole("button", { name: "Create customer" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`Existing Import ${stamp}`) })).toBeVisible();

    const csv = [
      "Customer ID,Display Name,First Name,Last Name,Email,Phone,Street,City,Province,Postal Code,Created Date",
      `A${stamp},Import Person ${stamp} [TEST DATA],Imp,Person,imp-${stamp}@example.com,604-555-0111,1 Import St,Surrey,BC,V3S3M1,2024-01-01`,
      `A${stamp},Import Person ${stamp} [TEST DATA],Imp,Person,imp-${stamp}@example.com,604-555-0111,2 Second Ave,Langley,BC,,2024-01-01`,
      `B${stamp},Import Strata ${stamp} [TEST DATA],,,,604-555-0112,9 Strata Way,White Rock,BC,,2024-02-01`,
      `C${stamp},Existing Import ${stamp} [TEST DATA],,,existing-${stamp}@example.com,604-555-0113,5 Known Rd,Surrey,BC,,2024-03-01`,
      ",,,,,,,,,,",
    ].join("\n");

    await page.goto("/settings/import");
    await page.getByLabel("Markate customer export (CSV)").setInputFiles({ name: `markate-${stamp}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Upload and preview" }).click();
    await expect(page).toHaveURL(/\/settings\/import\/[0-9a-f-]{36}/);

    await expect(page.getByText("New customers", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "1 Import St, Surrey | 2 Second Ave, Langley" })).toBeVisible();
    await expect(page.getByText(new RegExp(`matches “Existing Import ${stamp}.*” by email`))).toBeVisible();
    await expect(page.getByRole("button", { name: "Import 2 new · update 1" })).toBeVisible();

    // Changing a column's mapping updates the preview.
    await page.getByLabel('Import "Created Date" as').selectOption("ignore");
    await expect(page.getByLabel('Import "Created Date" as')).toHaveValue("ignore");

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Import 2 new · update 1" }).click();
    await expect(page.getByText("Imported", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`Import Person ${stamp}`) }).first().click();
    await expect(page.getByText("2 Second Ave")).toBeVisible();
    await expect(page.getByText("markate-import")).toBeVisible();

    await page.goBack();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Undo this import" }).click();
    await expect(page.getByText(/Undone\. 2 customers removed/)).toBeVisible();
    await page.goto("/customers");
    await expect(page.getByText(`Import Person ${stamp}`)).toHaveCount(0);
    await expect(page.getByText(`Existing Import ${stamp} [TEST DATA]`)).toBeVisible();
  });

  test("estimators can't import", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: statePath("estimator") });
    const p = await ctx.newPage();
    await expectNoAccess(p, "/settings/import");
    await ctx.close();
  });
});

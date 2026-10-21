import { expect, test } from "@playwright/test";
import { HTML_AS_PNG, JPEG_HEADER, oversize, PDF_WITH_JS, SVG } from "./fixtures";
import { statePath } from "./helpers";

test.describe("upload safety", () => {
  test.use({ storageState: statePath("owner") });

  test("unsafe or oversized pictures are refused with a clear message", async ({ page }) => {
    await page.goto("/settings/proposals?section=about");
    const input = page.getByLabel("Upload Photo").first();
    const alert = page.getByRole("alert").first();

    await input.setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: SVG });
    await expect(alert).toHaveText("SVG files aren't accepted. Please upload a JPG or PNG.");

    await input.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: HTML_AS_PNG });
    await expect(alert).toContainText("web page");

    await input.setInputFiles({ name: "huge.jpg", mimeType: "image/jpeg", buffer: oversize(3 * 1024 * 1024 + 1, JPEG_HEADER) });
    await expect(alert).toContainText("too large");
  });

  test("a PDF with scripts is refused", async ({ page }) => {
    await page.goto("/settings/proposals?section=documents");
    const card = page.getByRole("region", { name: "WorkSafeBC clearance letter" });
    if (await card.getByRole("button", { name: "Upload new version" }).isVisible()) await card.getByRole("button", { name: "Upload new version" }).click();
    await card.locator("input[type=file]").setInputFiles({ name: "letter.pdf", mimeType: "application/pdf", buffer: PDF_WITH_JS });
    await card.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("scripts");
  });

  test("document links need a valid proposal link", async ({ request }) => {
    expect((await request.get("/share/p/not-a-real-token-xxxxxxxxxxxx/documents/insurance_certificate")).status()).toBe(404);
  });
});

import { expect, test, type Page } from "@playwright/test";
import { pdf, photoJpeg } from "./fixtures";
import { statePath } from "./helpers";

// These tests change shared proposal settings, so they run one after another and put things back.
test.describe.configure({ mode: "serial" });

async function resetSection(page: Page, section: string, card = 0) {
  await page.goto(`/settings/proposals?section=${section}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Reset section to default" }).nth(card).click();
  await expect(page.getByText("Section reset to the default.")).toBeVisible();
}

test.describe("proposal settings (owner)", () => {
  test.use({ storageState: statePath("owner") });

  // Put every section these tests touch back to the defaults, even after a failure.
  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: statePath("owner") });
    const page = await ctx.newPage();
    for (const section of ["whyUs", "cover"]) {
      await page.goto(`/settings/proposals?section=${section}`);
      for (let i = 0; i < (await page.getByRole("button", { name: "Reset section to default" }).count()); i++) {
        page.once("dialog", (d) => d.accept());
        await page.getByRole("button", { name: "Reset section to default" }).nth(i).click();
        await expect(page.getByText("Section reset to the default.").first()).toBeVisible();
      }
    }
    await ctx.close();
  });

  test("an edited reason shows on proposals", async ({ page }) => {
    await page.goto("/settings/proposals?section=whyUs");
    await page.getByLabel("Title").first().fill("[TEST DATA] Great communication");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible();
    await page.goto("/settings/proposals/preview?jobType=interior");
    await expect(page.getByText("[TEST DATA] Great communication")).toBeVisible();
    await resetSection(page, "whyUs");
  });

  test("a cover can be customized for one job type only", async ({ page }) => {
    await page.goto("/settings/proposals?section=cover");
    await page.getByRole("tab", { name: "Cabinets" }).click();
    await page.getByRole("button", { name: "Customize for Cabinets" }).first().click();
    await page.getByLabel("Headline").fill("[TEST DATA] Cabinets look new again");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByText(/^Saved\./).first()).toBeVisible();
    await page.goto("/settings/proposals/preview?jobType=cabinets");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("[TEST DATA] Cabinets look new again");
    await page.goto("/settings/proposals/preview?jobType=interior");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("it's what's inside that counts");
    await resetSection(page, "cover", 0);
  });

  test("a replaced cover photo is served from our own site", async ({ page, request }) => {
    await page.goto("/settings/proposals?section=cover");
    await page.getByRole("tab", { name: "Interior", exact: true }).click();
    await page.getByLabel("Upload Cover photo").setInputFiles({ name: "new-cover.jpg", mimeType: "image/jpeg", buffer: await photoJpeg() });
    const thumb = page.locator("button[title^='Click the most important part'] img").first();
    await expect(thumb).toHaveAttribute("src", /\/api\/media\/[0-9a-f-]{36}/);
    const src = (await thumb.getAttribute("src"))!;
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByText(/^Saved\./).first()).toBeVisible();

    await page.goto("/settings/proposals/preview?jobType=interior");
    expect(decodeURIComponent((await page.getByTestId("cover-photo").locator("img").getAttribute("src")) ?? "")).toContain(src);
    const img = await request.get(src);
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toBe("image/jpeg");
    expect(img.headers()["cache-control"]).toContain("immutable");
    expect(img.headers()["x-content-type-options"]).toBe("nosniff");
    await resetSection(page, "cover", 0);
  });

  test("the insurance certificate stays current, and expired ones are hidden", async ({ page, browser }) => {
    await page.goto("/settings/proposals?section=documents");
    const card = page.locator("div.rounded-lg", { has: page.getByRole("heading", { name: "Liability insurance certificate" }) }).first();
    if (await card.getByRole("button", { name: "Upload new version" }).isVisible()) await card.getByRole("button", { name: "Upload new version" }).click();
    await card.locator("input[type=file]").setInputFiles({ name: "certificate.pdf", mimeType: "application/pdf", buffer: pdf("first") });
    await card.getByLabel("Expiry date").fill("2099-12-31");
    await card.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText(/^Uploaded\./)).toBeVisible();

    await page.goto("/settings/proposals/preview?jobType=interior");
    const link = page.getByRole("link", { name: /View liability insurance certificate \(PDF\)/ });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href"))!;
    const doc = await page.request.get(href);
    expect(doc.status()).toBe(200);
    expect(doc.headers()["content-type"]).toBe("application/pdf");
    expect(doc.headers()["content-security-policy"]).toContain("default-src 'none'");
    expect(doc.headers()["x-content-type-options"]).toBe("nosniff");
    expect(doc.headers()["cache-control"]).toContain("private");
    expect((await doc.body()).toString()).toContain("first");

    // Documents are never public by id.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    expect((await anon.request.get(href)).status()).toBe(404);
    await anon.close();

    // A new version replaces it everywhere.
    await page.goto("/settings/proposals?section=documents");
    await card.getByRole("button", { name: "Upload new version" }).click();
    await card.locator("input[type=file]").setInputFiles({ name: "certificate-2.pdf", mimeType: "application/pdf", buffer: pdf("second") });
    await card.getByLabel("Expiry date").fill("2099-12-31");
    await card.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText(/^Uploaded\./)).toBeVisible();
    await page.goto("/settings/proposals/preview?jobType=interior");
    const href2 = (await page.getByRole("link", { name: /View liability insurance certificate/ }).getAttribute("href"))!;
    expect((await (await page.request.get(href2)).body()).toString()).toContain("second");

    // Once expired, customers no longer see it and the dashboard warns.
    await page.goto("/settings/proposals?section=documents");
    await card.getByRole("button", { name: "Edit dates" }).click();
    await card.getByLabel("Expiry date").fill("2020-01-01");
    await card.getByRole("button", { name: "Save dates" }).click();
    await expect(card.getByText("Expired", { exact: true })).toBeVisible();
    await page.goto("/settings/proposals/preview?jobType=interior");
    await expect(page.getByRole("link", { name: /View liability insurance certificate/ })).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByText(/expired on .*Customers no longer see it/)).toBeVisible();

    // Clean up: hide it again.
    await page.goto("/settings/proposals?section=documents");
    page.once("dialog", (d) => d.accept());
    await card.getByRole("button", { name: "Stop showing to customers" }).click();
    await expect(card.getByText("Missing", { exact: true })).toBeVisible();
  });
});

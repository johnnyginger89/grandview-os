import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";

// The sample preview renders the real customer page around obviously fake data.
test.describe("proposal presentation", () => {
  test.use({ storageState: statePath("owner") });

  test("interior and exterior proposals get their own cover, terms and warranty", async ({ page }) => {
    const res = await page.goto("/settings/proposals/preview?jobType=interior");
    expect(res?.headers()["content-security-policy"] ?? "").toContain("img-src 'self' data: blob:");
    await expect(page.getByText("SAMPLE PROPOSAL")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("it's what's inside that counts");
    expect(await page.getByTestId("cover-photo").locator("img").getAttribute("src")).toContain("hero-interior");
    for (const name of ["About Us", "Why Work With Us?", "Reviews", "Your Project", "Next Step"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(page.locator("#why-us li")).toHaveCount(6);
    await expect(page.getByText(/for a period of 24 months/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Accept – \$/ })).toBeDisabled();

    await page.goto("/settings/proposals/preview?jobType=exterior");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("CURB APPEAL");
    expect(await page.getByTestId("cover-photo").locator("img").getAttribute("src")).toContain("hero-exterior");
    await expect(page.getByText(/for a period of 36 months/)).toBeVisible();
  });

  test("ticking an upgrade updates the total on the server", async ({ page }) => {
    await page.goto("/settings/proposals/preview?jobType=interior");
    const total = page.getByTestId("grand-total");
    const before = await total.innerText();
    await page.getByRole("checkbox", { name: /Living room ceiling/ }).first().check();
    await expect(total).not.toHaveText(before);
    await expect(page.getByText("Added", { exact: true })).toBeVisible();
  });

  test("printing keeps the estimate and terms and drops the marketing", async ({ page }) => {
    await page.goto("/settings/proposals/preview?jobType=interior");
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect(page.locator("#portfolio")).toBeHidden();
    await expect(page.locator("#your-project article")).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Warranty" })).toBeVisible();
    expect(await page.locator("[data-contract] details:not([open])").count()).toBe(0);
  });

  test("phone layout: no sideways scrolling, sticky signing bar @mobile", async ({ page }) => {
    await page.goto("/settings/proposals/preview?jobType=interior");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(1);
    const hero = await page.getByTestId("cover-photo").locator("img").boundingBox();
    expect(Math.abs(hero!.width / hero!.height - 1.5)).toBeLessThan(0.05);

    await page.locator("#about").scrollIntoViewIfNeeded();
    await expect(page.getByRole("navigation", { name: "Proposal sections" }).getByRole("link", { name: "Reviews" })).toBeVisible();
    const cta = page.getByRole("link", { name: "Review & sign" }).last();
    await expect(cta).toBeVisible();
    await page.locator("#your-project").scrollIntoViewIfNeeded();
    expect(await overflow()).toBeLessThanOrEqual(1);
    const size = await page.locator("#your-project article li").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(14);

    await cta.click();
    await expect(page.locator("#next-step-title")).toBeInViewport();
    await page.getByRole("button", { name: /^Accept – \$/ }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: /^Accept – \$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review & sign" })).toHaveCount(0);
  });
});

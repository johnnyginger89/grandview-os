import { expect, test } from "@playwright/test";
import { expectNoAccess, statePath } from "./helpers";

test.describe("signed out", () => {
  test("signed-out users are sent to login", async ({ page }) => {
    await page.goto("/customers");
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong password is rejected without revealing which part was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("owner@dev.grandview.local");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  });
});

test.describe("painter", () => {
  test.use({ storageState: statePath("painter") });
  test("cannot reach customer, estimate, rate, lead or settings pages", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/my-jobs/);
    await expect(page.getByRole("link", { name: "Estimates" })).toHaveCount(0);
    for (const p of ["/customers", "/estimates", "/rates", "/settings", "/settings/proposals", "/settings/proposals/preview", "/estimates/00000000-0000-4000-8000-000000000000/proposal-preview", "/leads", "/leads/new", "/estimates/new"]) await expectNoAccess(page, p);
  });
});

test.describe("subcontractor", () => {
  test.use({ storageState: statePath("subcontractor") });
  test("cannot reach the pipeline or customers", async ({ page }) => {
    await expectNoAccess(page, "/leads");
    await expectNoAccess(page, "/customers");
  });
});

test.describe("estimator", () => {
  test.use({ storageState: statePath("estimator") });
  test("cannot manage settings or edit rates", async ({ page }) => {
    await expectNoAccess(page, "/settings");
    await expectNoAccess(page, "/settings/proposals");
    await expectNoAccess(page, "/settings/proposals/preview?jobType=interior");
    await page.goto("/rates");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Settings tabs" }).getByRole("link", { name: "Rates" })).toHaveAttribute("aria-current", "page");
    // Estimators only see the Rates tab of Settings.
    await expect(page.getByRole("navigation", { name: "Settings tabs" }).getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "New rate" })).toHaveCount(0);
  });
});

import { expect, test } from "@playwright/test";

// Runs only against a fresh, migrated database with no users, e.g.
//   E2E_SETUP_BASE_URL=http://localhost:3100 E2E_SETUP_TOKEN=... npx playwright test first-run-setup
const base = process.env.E2E_SETUP_BASE_URL;
const token = process.env.E2E_SETUP_TOKEN ?? "";

test.describe("first-run owner setup", () => {
  test.skip(!base, "set E2E_SETUP_BASE_URL to run against a fresh database");

  test("wrong code is rejected, owner is created, 2FA is required, setup closes", async ({ page }) => {
    await page.goto(`${base}/setup`);
    await page.getByLabel("Setup code").fill("wrong-code-wrong-code-wrong-code-123");
    await page.getByLabel("Your name").fill("Test Owner");
    await page.getByLabel("Email").fill("owner-setup@example.com");
    await page.getByLabel("Password", { exact: true }).fill("a long test password");
    await page.getByLabel("Confirm password").fill("a long test password");
    await page.getByRole("button", { name: "Create owner account" }).click();
    await expect(page.getByText("That setup code is not valid.")).toBeVisible();

    await page.getByLabel("Setup code").fill(token);
    await page.getByLabel("Password", { exact: true }).fill("a long test password");
    await page.getByLabel("Confirm password").fill("a long test password");
    await page.getByRole("button", { name: "Create owner account" }).click();
    await page.waitForURL(/\/login/);

    await page.getByLabel("Email").fill("owner-setup@example.com");
    await page.getByLabel("Password").fill("a long test password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/account\/security/);
    await expect(page.getByText("two-factor authentication is required")).toBeVisible();
    await page.goto(`${base}/customers`);
    await expect(page).toHaveURL(/account\/security/);

    const res = await page.request.get(`${base}/setup`);
    expect(res.status()).toBe(404);
    const health = await page.request.get(`${base}/api/health`);
    expect(await health.json()).toMatchObject({ ok: true, db: "up" });
  });
});

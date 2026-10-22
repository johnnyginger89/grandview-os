import { expect, test } from "@playwright/test";
import { DEV_PASSWORD, statePath } from "./helpers";

/* Anyone can change their own password from the account menu. */
test.use({ storageState: statePath("subcontractor") });

test("change your password, and back", async ({ page }) => {
  await page.goto("/account/security");
  const change = async (from: string, to: string, again = to) => {
    await page.getByLabel("Current password").fill(from);
    await page.getByLabel("New password", { exact: true }).fill(to);
    await page.getByLabel("New password again").fill(again);
    await page.getByRole("button", { name: "Change password" }).click();
  };
  await change(DEV_PASSWORD, "a-new-test-password-123", "something-else-123");
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await change("wrong-password-12345", "a-new-test-password-123");
  await expect(page.getByRole("alert").filter({ hasText: "current password is incorrect" })).toBeVisible();
  await change(DEV_PASSWORD, "a-new-test-password-123");
  await expect(page.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();
  await change("a-new-test-password-123", DEV_PASSWORD);
  await expect(page.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();
});

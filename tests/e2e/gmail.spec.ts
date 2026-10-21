import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";

/* Settings → Integrations → Gmail, before Google sign-in is set up on the server (as in tests). */
test.use({ storageState: statePath("owner") });

test("Gmail card explains the one-time Google setup", async ({ page }) => {
  await page.goto("/settings?tab=integrations");
  const card = page.getByRole("region", { name: "Gmail" });
  await expect(card.getByText("Not connected")).toBeVisible();
  await expect(card.getByText("turn on Gmail API")).toBeVisible();
  await expect(card.locator("code").first()).toHaveText(/\/api\/integrations\/google\/callback$/);
});

test("the return trip only shows our own messages", async ({ page }) => {
  await page.goto("/settings?tab=integrations&gmail=error&reason=" + encodeURIComponent("Call 555-0100 and read out your password"));
  const card = page.getByRole("region", { name: "Gmail" });
  await expect(card.getByRole("alert")).toHaveText("Gmail couldn't be connected. Try again.");
  await page.goto("/settings?tab=integrations&gmail=error&reason=scopes");
  await expect(card.getByRole("alert")).toContainText("tick both Gmail boxes");
});

test("a sign-in return without our state is refused", async ({ page }) => {
  await page.goto("/api/integrations/google/callback?code=abc&state=forged");
  await expect(page).toHaveURL(/gmail=error&reason=state/);
  await expect(page.getByRole("region", { name: "Gmail" }).getByRole("alert")).toContainText("took too long or was started elsewhere");
});

test("only the owner can start a Gmail connection", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: statePath("estimator") });
  const page = await ctx.newPage();
  await page.goto("/api/integrations/google/start");
  await expect(page).toHaveURL(/\/no-access/);
  await ctx.close();
});

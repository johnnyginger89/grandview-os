import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";
import { draftThreeThousandDollarEstimate } from "./sales";

/*
 * Following up on a proposal: one click writes the email from the template (same subject,
 * so it stays one conversation), the user checks it and sends. Email isn't switched on in
 * tests, so it's logged instead of sent.
 */
test.use({ storageState: statePath("owner") });

test("follow up on a sent proposal from the estimate", async ({ page }) => {
  const name = await draftThreeThousandDollarEstimate(page);
  await page.getByRole("button", { name: "Send proposal" }).click();
  await page.getByLabel("Subject").fill("Your painting proposal [TEST DATA]");
  await page.getByRole("button", { name: "Send proposal" }).last().click();
  const link = await page.getByLabel("Proposal link").inputValue();
  await page.getByRole("button", { name: "Done" }).click();

  const panel = page.locator("#proposals");
  await panel.getByRole("button", { name: "Follow up" }).click();
  const dialog = page.getByRole("dialog", { name: `Follow up with ${name}` });
  await expect(dialog.getByLabel("To")).toHaveValue(/^sale-\d+@example\.com$/);
  await expect(dialog.getByLabel("Subject")).toHaveValue("Re: Your painting proposal [TEST DATA]");
  await expect(dialog.getByLabel("Email")).toHaveValue(new RegExp(`Just checking in on the proposal[\\s\\S]*${link.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));

  // The user can't send an empty email.
  await dialog.getByLabel("Email").fill("");
  await dialog.getByRole("button", { name: "Send follow-up" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Write the email");

  await dialog.getByLabel("Email").fill("Hi, just checking in. Any questions?");
  await dialog.getByRole("button", { name: "Send follow-up" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole("status")).toContainText(/Follow-up (emailed|saved)/);
  await expect(panel.getByText(/Followed up once/)).toBeVisible();

  // It's on the customer's timeline.
  await page.getByRole("link", { name: name, exact: true }).first().click();
  await expect(page.getByText(/Followed up on the proposal for estimate #\d+/)).toBeVisible();
});

test("Home lists proposals to chase", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Proposals to follow up" })).toBeVisible();
});

test("crew can't load a follow-up draft", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: statePath("painter") });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/my-jobs/);
  await expect(page.getByRole("region", { name: "Proposals to follow up" })).toHaveCount(0);
  await ctx.close();
});

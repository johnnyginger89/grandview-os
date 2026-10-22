import { expect, test } from "@playwright/test";
import { backdateProposal, hasDatabase, NEEDS_DATABASE } from "./db";
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

test("an expired proposal drops off Home and isn't offered for a follow-up", async ({ page }) => {
  test.skip(!hasDatabase(), NEEDS_DATABASE);
  const name = await draftThreeThousandDollarEstimate(page);
  const estimate = page.url();
  await page.getByRole("button", { name: "Send proposal" }).click();
  await page.getByRole("button", { name: "Send proposal" }).last().click();
  const link = await page.getByLabel("Proposal link").inputValue();
  await page.getByRole("button", { name: "Done" }).click();

  // Sent weeks ago and still valid: time to chase (the oldest come first on Home).
  await backdateProposal(link, { sentDaysAgo: 29 });
  await page.goto("/");
  const chase = page.getByRole("region", { name: "Proposals to follow up" });
  await expect(chase.getByText(name)).toBeVisible();

  // Once it has expired the customer can't accept it, so there's nothing to chase.
  await backdateProposal(link, { expired: true });
  await page.reload();
  await expect(chase).toBeVisible();
  await expect(chase.getByText(name)).toHaveCount(0);
  await page.goto(estimate);
  await expect(page.getByRole("region", { name: "Expired proposal" })).toBeVisible();
  await expect(page.locator("#proposals").getByRole("button", { name: "Follow up" })).toHaveCount(0);
});

test("crew can't load a follow-up draft", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: statePath("painter") });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/my-jobs/);
  await expect(page.getByRole("region", { name: "Proposals to follow up" })).toHaveCount(0);
  await ctx.close();
});

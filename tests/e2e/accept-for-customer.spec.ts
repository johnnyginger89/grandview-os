import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";
import { draftThreeThousandDollarEstimate } from "./sales";

/*
 * The office accepts a proposal for the customer ("Mark as accepted"), and the
 * proposal email comes from the editable "Sending a proposal" template.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: statePath("owner") });

let estimateUrl = "";

test("the proposal email is written from the template and can be edited before sending", async ({ page }) => {
  const name = await draftThreeThousandDollarEstimate(page);
  estimateUrl = page.url();
  await page.getByRole("button", { name: "Send proposal" }).click();
  await expect(page.getByLabel("Subject")).toHaveValue(/Your painting proposal from /);
  const body = page.getByLabel("Email", { exact: true });
  await expect(body).toHaveValue(/^Hi /);
  await expect(body).toHaveValue(/Interior repaint/);
  await expect(body).toHaveValue(/\[Proposal link\]/);
  await body.fill(`Hi ${name.split(" ")[0]},\n\nHere it is: [Proposal link]\n\nThanks!`);
  await page.getByRole("button", { name: "Send proposal" }).last().click();
  // No email provider in development: the proposal is created and the link shown.
  const link = await page.getByLabel("Proposal link").inputValue();
  expect(link).toMatch(/\/share\/p\/[A-Za-z0-9_-]+$/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#proposals").getByText(/sent .* to sale-/)).toBeVisible();
});

test("Mark as accepted saves the latest edits, ticks the customer's pre-selected upgrades and shows the total", async ({ page, browser }) => {
  test.skip(!estimateUrl, "needs the estimate above");
  await page.goto(estimateUrl);
  // Changed after sending: the office is told the customer still has the version that was sent.
  const notice = page.getByText(/^The customer still sees the version sent on .+\. Send it again to update it\.$/);
  await expect(notice).toHaveCount(0);
  await page.getByLabel("Add item").first().selectOption({ label: "Ceilings – roll & cut" });
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: /Ceilings – roll & cut/ }).click();
  await page.getByLabel("Override price").fill("500");
  await page.getByText("Optional upgrade", { exact: true }).click();
  await page.getByText("Pre-selected (in the total)").click();

  // Straight to Mark as accepted, without waiting for the autosave: it saves first.
  await page.getByRole("button", { name: "More ways to send" }).click();
  await page.getByRole("button", { name: "Mark as accepted" }).click();
  const dialog = page.getByRole("dialog", { name: "Mark as accepted" });
  const upgrade = dialog.getByRole("checkbox", { name: /Ceilings – roll & cut/ });
  await expect(upgrade).toBeChecked();
  const total = dialog.getByTestId("accept-total");
  // $3,000 walls + $500 ceiling, 5% GST, 20% deposit: the same numbers as the customer's page.
  await expect(total).toHaveText("$3,675.00");
  await expect(dialog.getByText("$175.00")).toBeVisible();
  await expect(dialog.getByTestId("accept-deposit")).toHaveText("$735.00");
  await upgrade.uncheck();
  await expect(total).toHaveText("$3,150.00");
  await expect(dialog.getByTestId("accept-deposit")).toHaveText("$630.00");
  await upgrade.check();
  await expect(total).toHaveText("$3,675.00");

  await expect(dialog.getByLabel("Who accepted it?")).not.toHaveValue("");
  await dialog.getByLabel("Who accepted it?").fill("Phone Customer [TEST DATA]");
  // A method is required.
  await dialog.getByRole("button", { name: "Mark as accepted" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Choose how they accepted");
  await dialog.getByLabel("By phone").check();
  await dialog.getByLabel("Note (optional)").fill("SECRET-OFFICE-NOTE wants a Monday start");
  await dialog.getByRole("button", { name: "Mark as accepted" }).click();

  // Accepting creates the job and its work order before the job page opens.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Interior repaint");
  await expect(page.getByText("Need to schedule").first()).toBeVisible();

  await page.goto(estimateUrl);
  await expect(page.getByRole("button", { name: "More ways to send" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send proposal" })).toHaveCount(0);
  const accepted = page.locator("#proposals").getByText(/Accepted by phone by Phone Customer \[TEST DATA\]/);
  await expect(accepted).toBeVisible();

  // The customer's copy shows the acceptance, at the total the office saw, but never the office note.
  const link = await page.locator("#proposals").getByRole("link", { name: "Open" }).first().getAttribute("href");
  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const cp = await customer.newPage();
  const res = await cp.goto(link!);
  await expect(cp.getByText("Accepted – thank you!").first()).toBeVisible();
  await expect(cp.getByTestId("grand-total")).toHaveText("$3,675.00");
  expect(await res!.text()).not.toContain("SECRET-OFFICE-NOTE");
  await customer.close();
});

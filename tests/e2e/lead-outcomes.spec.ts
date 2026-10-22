import { expect, test, type Page } from "@playwright/test";
import { statePath } from "./helpers";
import { addRoom, startBlankEstimate } from "./sales";

/*
 * Proposal outcomes reach the lead (audit A-SAL-10), and a link taken back shows the customer
 * nothing private (A-SEC-4).
 */
test.use({ storageState: statePath("owner") });

/** A lead, a priced estimate for it from the lead page, and a proposal link (not emailed). Returns the link and lead number. */
async function sentQuoteForLead(page: Page, label: string) {
  const stamp = Date.now();
  const customerName = `${label} ${stamp}`;
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill(label);
  await page.getByLabel("Last name").fill(String(stamp));
  await page.getByLabel("Email").fill(`outcome-${stamp}@example.com`);
  await page.getByText("Interior", { exact: true }).click();
  await page.getByRole("button", { name: "+ Add address and project details" }).click();
  await page.getByLabel("Street address").fill(`${stamp % 1000} Example St`);
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  const leadNumber = (await page.getByText(/^Lead #\d+/).first().textContent())!.match(/#(\d+)/)![1];
  await page.getByRole("link", { name: "Create estimate" }).click();
  await startBlankEstimate(page);
  await addRoom(page, "Living room", { size: "15 12 8", only: ["Walls – roll & cut"] });
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Send proposal" }).click();
  const dialog = page.getByRole("dialog", { name: "Send proposal" });
  await dialog.getByText("Email it to the customer").click();
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = await dialog.getByLabel("Proposal link").inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  return { link, leadNumber, customerName };
}

test("a declined quote offers to move its lead to Lost, with a reason", async ({ page, browser }) => {
  const { link, leadNumber } = await sentQuoteForLead(page, "Decline");
  const estimateUrl = page.url();

  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const cp = await customer.newPage();
  await cp.goto(link);
  await cp.getByRole("button", { name: "Decline", exact: true }).click();
  await cp.getByLabel("Reason (optional)").fill("Going with a cheaper quote [TEST DATA]");
  await cp.getByRole("button", { name: "Confirm decline" }).click();
  await expect(cp.getByText("This proposal was declined.").first()).toBeVisible();
  await customer.close();

  await page.goto(estimateUrl);
  const prompt = page.getByRole("group", { name: "Declined" });
  await expect(prompt).toContainText(`Declined: "Going with a cheaper quote [TEST DATA]". Move lead #${leadNumber} to Lost?`);
  await prompt.getByLabel("Why it was lost").selectOption("Price");
  await prompt.getByRole("button", { name: "Move to Lost" }).click();
  await expect(prompt).toBeHidden();
  await expect(page.getByRole("region", { name: "Lead" }).getByText("Lost", { exact: true })).toBeVisible();
});

test("a withdrawn proposal shows the customer nothing about the job; the office still sees it", async ({ page, browser }) => {
  const { link, customerName } = await sentQuoteForLead(page, "Withdrawn");
  page.once("dialog", (d) => d.accept());
  await page.locator("#proposals").getByRole("button", { name: "Withdraw" }).click();
  await expect(page.locator("#proposals").getByText("withdrawn", { exact: true })).toBeVisible();

  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const cp = await customer.newPage();
  const res = await cp.goto(link);
  await expect(cp.getByText("This proposal is no longer available.")).toBeVisible();
  const html = (await res?.text()) ?? "";
  expect(html).not.toContain(customerName);
  expect(html).not.toMatch(/\$[\d,]+\.\d\d/);
  await customer.close();

  // The office's preview of the same link still shows the proposal, marked withdrawn.
  await page.goto(link);
  await expect(page.getByText("This proposal was withdrawn.")).toBeVisible();
  await expect(page.locator("body")).toContainText(customerName);
});

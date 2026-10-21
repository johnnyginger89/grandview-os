import { expect, type Browser, type Page } from "@playwright/test";

/**
 * Creates a customer and a $3,000 (pre-GST) estimate, sends it, and signs it as the customer. Returns the customer name.
 * Optionally gives the walls a colour and the estimate an internal note (to check crew views never show it).
 */
export async function sellThreeThousandDollarJob(page: Page, browser: Browser, opts: { colour?: string; internalNote?: string } = {}) {
  const stamp = Date.now();
  const name = `Sale Test ${stamp} [TEST DATA]`;
  await page.goto("/customers/new");
  await page.getByLabel("Customer name").fill(name);
  await page.getByLabel("Email").fill(`sale-${stamp}@example.com`);
  await page.getByLabel("Street address").fill("1 Example St");
  await page.getByRole("button", { name: "Create customer" }).click();
  await page.getByRole("link", { name: "New estimate" }).click();
  await page.getByLabel("Job title").fill("Interior repaint");
  await page.getByRole("button", { name: "Create and start estimating" }).click();
  await page.getByRole("button", { name: "Living room" }).click();
  await page.getByLabel("Add item").first().selectOption({ label: "Walls – roll & cut" });
  await page.getByRole("button", { name: /Walls – roll & cut/ }).click();
  await page.getByLabel("Override price").fill("3000");
  if (opts.colour) await page.getByLabel("Colour", { exact: true }).fill(opts.colour);
  await page.getByRole("button", { name: /Walls – roll & cut/ }).click();
  if (opts.internalNote) await page.getByLabel(/Internal notes/).fill(opts.internalNote);
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Send proposal" }).click();
  await page.getByText("Email it to the customer").click();
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Proposal link").inputValue();

  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const cp = await customer.newPage();
  await cp.goto(link);
  await cp.getByLabel("Full name").fill("Sale Customer");
  const pad = cp.getByLabel(/Signature pad/);
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await cp.mouse.move(box.x + 20, box.y + 60);
  await cp.mouse.down();
  for (let i = 1; i <= 10; i++) await cp.mouse.move(box.x + 20 + i * 18, box.y + 60 + (i % 2 ? -20 : 20));
  await cp.mouse.up();
  await cp.getByText(/I agree to the Terms and Conditions/).click();
  await cp.getByRole("button", { name: /^Accept – \$/ }).click();
  await expect(cp.getByText("Accepted – thank you!").first()).toBeVisible();
  await customer.close();
  return name;
}

export async function kpiValue(page: Page, testId: string): Promise<number> {
  return Number(await page.locator(`[data-testid="${testId}"] [data-value]`).first().getAttribute("data-value"));
}

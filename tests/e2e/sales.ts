import { expect, type Browser, type Page } from "@playwright/test";

/**
 * Creates a customer and a $3,000 (pre-GST) estimate, sends it, and signs it as the customer. Returns the customer name.
 * Optionally gives the walls a colour and the estimate an internal note (to check crew views never show it).
 */
export async function sellThreeThousandDollarJob(page: Page, browser: Browser, opts: DraftOptions = {}) {
  const name = await draftThreeThousandDollarEstimate(page, opts);
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

interface DraftOptions {
  colour?: string;
  internalNote?: string;
  /** Room size in feet, so the walls get a measured area (and hours and paint). */
  size?: { length: string; width: string };
}

/** Creates a customer and a $3,000 (pre-GST) estimate and leaves the browser on the estimate. Returns the customer name. */
export async function draftThreeThousandDollarEstimate(page: Page, opts: DraftOptions = {}) {
  const stamp = Date.now();
  const name = `Sale Test ${stamp} [TEST DATA]`;
  await page.goto("/customers/new");
  await page.getByLabel("Customer name").fill(name);
  await page.getByLabel("Email").fill(`sale-${stamp}@example.com`);
  await page.getByLabel("Street address").fill("1 Example St");
  await page.getByRole("button", { name: "Create customer" }).click();
  await page.getByRole("link", { name: "New estimate" }).click();
  await startBlankEstimate(page);
  await addRoom(page, "Living room", { size: opts.size ? `${opts.size.length} ${opts.size.width}` : undefined, only: ["Walls – roll & cut"] });
  await page.getByRole("button", { name: /Walls – roll & cut/ }).click();
  await page.getByLabel("Override price").fill("3000");
  if (opts.colour) await page.getByLabel("Colour", { exact: true }).fill(opts.colour);
  await page.getByRole("button", { name: /Walls – roll & cut/ }).click();
  if (opts.internalNote) await writeInternalNote(page, opts.internalNote);
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  return name;
}

/** On "New estimate" with the customer already chosen: start with an empty estimate. */
export async function startBlankEstimate(page: Page) {
  await page.getByRole("button", { name: "Start blank" }).click();
  // Two round trips (create, then open the editor), which a busy dev server can take a while over.
  await expect(page).toHaveURL(/\/estimates\/[0-9a-f-]{36}/, { timeout: 15_000 });
}

/**
 * The editor's "New room" form: pick the name, type the size in one box ("15 12" or
 * "15 12 8"), keep only the surfaces listed in `only` (by name), Add room.
 */
export async function addRoom(page: Page, name: string, opts: { size?: string; only?: string[] } = {}) {
  const form = page.getByRole("region", { name: "New room" });
  if (!(await form.isVisible())) await page.getByRole("button", { name: "Add room", exact: true }).click();
  await form.getByRole("group", { name: "Room name" }).getByRole("button", { name, exact: true }).click();
  if (opts.size) await form.getByLabel("Length in feet").fill(opts.size);
  if (opts.only) {
    const ticked = form.getByRole("group", { name: /Paint in this room/ }).locator('button[aria-pressed="true"]');
    for (let i = (await ticked.count()) - 1; i >= 0; i--) {
      const chip = ticked.nth(i);
      const text = (await chip.innerText()).trim();
      if (!opts.only.some((o) => text.startsWith(o))) await chip.click();
    }
  }
  await form.getByRole("button", { name: "Add room", exact: true }).click();
  await expect(form).toBeHidden();
}

export async function writeInternalNote(page: Page, note: string) {
  const notes = page.getByLabel(/Internal notes/);
  if (!(await notes.isVisible())) await page.getByRole("button", { name: /Proposal wording & notes/ }).click();
  await notes.fill(note);
}

export async function kpiValue(page: Page, testId: string): Promise<number> {
  return Number(await page.locator(`[data-testid="${testId}"] [data-value]`).first().getAttribute("data-value"));
}

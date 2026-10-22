import { expect, test, type Locator, type Page } from "@playwright/test";
import { backdateProposal, hasDatabase, NEEDS_DATABASE } from "./db";
import { statePath } from "./helpers";
import { addRoom, draftThreeThousandDollarEstimate, startBlankEstimate, writeInternalNote } from "./sales";

/** A date as the app prints it: "Nov 21, 2026" or "November 21, 2026". */
const DAY = String.raw`[A-Z][a-z]+\.? \d{1,2}, \d{4}`;
/** "November 21, 2026" and "Nov 21, 2026" are the same day. */
const sameDay = (a: string, b: string) => a.slice(0, 3) === b.slice(0, 3) && a.replace(/^\D+/, "") === b.replace(/^\D+/, "");
/** The estimate header's "· valid until <date>", shown while the open proposal can be accepted. */
const validityInHeader = (page: Page) => page.getByText(new RegExp(`· valid until ${DAY}`));

/** In the Send dialog: link only (no email), then close. Returns the link. */
async function createLink(dialog: Locator) {
  await dialog.getByText("Email it to the customer").click();
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = await dialog.getByLabel("Proposal link").inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  return link;
}

test.describe("proposal", () => {
  test.use({ storageState: statePath("owner") });

  test("send, customer picks an upgrade and signs, project is created", async ({ page, browser }) => {
    // Build a small estimate
    await page.goto("/customers/new");
    const stamp = Date.now();
    await page.getByLabel("Customer name").fill(`Proposal Test ${stamp}`);
    await page.getByLabel("Email").fill(`proposal-${stamp}@example.com`);
    await page.getByLabel("Street address").fill("1 Example St");
    await page.getByLabel("City").fill("Surrey");
    await page.getByRole("button", { name: "Create customer" }).click();
    await page.getByRole("link", { name: "New estimate" }).click();
    await page.getByLabel("Job title (optional)").fill("Interior repaint");
    await startBlankEstimate(page);
    await addRoom(page, "Living room", { size: "20x15x9", only: ["Walls – roll & cut"] });
    // Price the walls above the $2,000 minimum so an upgrade visibly changes the total.
    await page.getByRole("button", { name: /Walls – roll & cut/ }).click();
    await page.getByLabel("Override price").fill("3000");
    await page.getByRole("button", { name: /Walls – roll & cut/ }).click();
    await page.getByLabel("Add item").first().selectOption({ label: "Ceilings – roll & cut" });
    // Make the ceiling an optional upgrade
    await page.getByRole("button", { name: /Ceilings – roll & cut/ }).click();
    await page.getByLabel("Colour").fill("SW 7008 Alabaster");
    await page.getByText("Optional upgrade", { exact: true }).click();
    await writeInternalNote(page, "SECRET-INTERNAL note for the office");
    await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });

    // Send (link only; email isn't configured in tests)
    await page.getByRole("button", { name: "Send proposal" }).click();
    await page.getByText("Email it to the customer").click();
    await page.getByRole("button", { name: "+ Add a note on the proposal page" }).click();
    await page.getByLabel("Note at the top of the proposal page (optional)").fill("Great meeting you – here's your quote.");
    await page.getByRole("button", { name: "Create link" }).click();
    const link = await page.getByLabel("Proposal link").inputValue();
    expect(link).toMatch(/\/share\/p\/[A-Za-z0-9_-]{20,}/);

    // Customer (no login) opens it
    const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const cp = await customer.newPage();
    const res = await cp.goto(link);
    const html = (await res?.text()) ?? "";
    for (const secret of ["laborCostPerHour", "billingRatePerHour", "targetMargin", "internalNotes", "rateSnapshot", "pricePerGallon", "materialMarkupPct", "minimumJobPrice", "prepFactor", "overrideHours", "markupPct", "productionRate", "SECRET-INTERNAL"]) {
      expect(html, `public page must not contain ${secret}`).not.toContain(secret);
    }
    await expect(cp.getByRole("heading", { level: 1 })).toContainText(/it's what's inside that counts/i);
    await expect(cp.locator("#your-project").getByText("Interior repaint")).toBeVisible();
    await expect(cp.getByText("Great meeting you")).toBeVisible();
    await expect(cp.getByText("Paint Walls")).toBeVisible();
    await expect(cp.getByText(/EST-\d+/).first()).toBeVisible();
    await expect(cp.getByText("Not yet included")).toBeVisible();
    await expect(cp.getByText(/for a period of 24 months/)).toBeVisible();
    const before = await cp.getByTestId("grand-total").innerText();
    await cp.getByRole("checkbox", { name: /Optional Ceilings – roll & cut/ }).first().check();
    await expect(cp.getByTestId("grand-total")).not.toHaveText(before);
    await expect(cp.getByText("Added", { exact: true })).toBeVisible();

    // Sign
    await cp.getByLabel("Full name").fill("Pat Customer");
    const pad = cp.getByLabel(/Signature pad/);
    await pad.scrollIntoViewIfNeeded();
    const box = (await pad.boundingBox())!;
    await cp.mouse.move(box.x + 20, box.y + 60);
    await cp.mouse.down();
    for (let i = 1; i <= 12; i++) await cp.mouse.move(box.x + 20 + i * 18, box.y + 60 + (i % 2 ? -20 : 20));
    await cp.mouse.up();
    await cp.getByText(/I agree to the Terms and Conditions/).click();
    await cp.getByRole("button", { name: /^Accept – \$/ }).click();
    await expect(cp.getByText("Accepted – thank you!").first()).toBeVisible();
    await customer.close();

    // Staff side: project created, estimate locked
    await page.reload();
    await expect(page.getByText(/job #\d+ was created/)).toBeVisible();
    await expect(page.getByText("Accepted – locked")).toBeVisible();
    await page.getByText(/job #\d+ was created/).click();
    await expect(page.getByRole("heading", { name: /Proposal Test/ })).toBeVisible();
    await expect(page.getByText("Pat Customer")).toBeVisible();
  });

  test("a quote is valid from the day it's sent: the email, the estimate and the customer's copy agree", async ({ page, browser }) => {
    await draftThreeThousandDollarEstimate(page);
    const header = validityInHeader(page);
    await expect(header, "a draft has no date yet").toHaveCount(0);

    await page.getByRole("button", { name: "Send proposal" }).click();
    const send = page.getByRole("dialog", { name: "Send proposal" });
    const emailed = new RegExp(`This proposal is valid until (${DAY})\\.`).exec(await send.getByLabel("Email", { exact: true }).inputValue())?.[1];
    expect(emailed, "the email states the date").toBeTruthy();
    const link = await createLink(send);

    const shown = new RegExp(`valid until (${DAY})`).exec(await header.innerText())![1];
    expect(sameDay(emailed!, shown), `${emailed} / ${shown}`).toBe(true);
    await expect(page.locator("#proposals").getByText(`Valid until ${shown}`)).toBeVisible();
    const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const cp = await customer.newPage();
    await cp.goto(link);
    await expect(cp.locator("#your-project").getByText(`Valid until ${shown}`)).toBeVisible();
    await customer.close();
  });

  test("an expired proposal is flagged and can be sent again", async ({ page, browser }) => {
    test.skip(!hasDatabase(), NEEDS_DATABASE);
    await draftThreeThousandDollarEstimate(page);
    await page.getByRole("button", { name: "Send proposal" }).click();
    const link = await createLink(page.getByRole("dialog", { name: "Send proposal" }));
    const header = validityInHeader(page);
    const fromToday = new RegExp(`valid until (${DAY})`).exec(await header.innerText())![1];

    // Time passes: the customer's link says so, and the estimate offers a fresh proposal.
    await backdateProposal(link, { expired: true });
    const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const cp = await customer.newPage();
    await cp.goto(link);
    await expect(cp.getByText("This proposal has expired.")).toBeVisible();
    await page.reload();
    const flag = page.getByRole("region", { name: "Expired proposal" });
    await expect(flag).toContainText(new RegExp(`Expired on ${DAY}\\. The customer can no longer accept this proposal\\.`));
    await expect(page.locator("#proposals").getByText("expired", { exact: true })).toBeVisible();
    await expect(header).toHaveCount(0);

    await flag.getByRole("button", { name: "Send updated proposal" }).click();
    const fresh = await createLink(page.getByRole("dialog", { name: "Send updated proposal" }));
    expect(fresh).not.toBe(link);
    await expect(flag).toBeHidden();
    // Counted from today again, not from the first send.
    await expect(header).toHaveText(new RegExp(`· valid until ${fromToday}`));
    await cp.goto(fresh);
    await expect(cp.getByRole("button", { name: /^Accept – \$/ })).toBeVisible();
    await customer.close();
  });

  test("painters cannot see projects", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: statePath("painter") });
    const p = await ctx.newPage();
    await p.goto("/projects");
    await expect(p).toHaveURL(/no-access|my-jobs/);
    await ctx.close();
  });
});

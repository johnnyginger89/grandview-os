import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";

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
    await page.getByLabel("Job title").fill("Interior repaint");
    await page.getByRole("button", { name: "Create and start estimating" }).click();
    await page.getByRole("button", { name: "Living room" }).click();
    await page.getByLabel("Length (ft)").fill("20");
    await page.getByLabel("Width (ft)").fill("15");
    await page.getByLabel("Height (ft)").fill("9");
    await page.getByLabel("Add item").first().selectOption({ label: "Walls – roll & cut" });
    // Price the walls above the $2,000 minimum so an upgrade visibly changes the total.
    await page.getByRole("button", { name: /Walls – roll & cut/ }).click();
    await page.getByLabel("Override price").fill("3000");
    await page.getByRole("button", { name: /Walls – roll & cut/ }).click();
    await page.getByLabel("Add item").first().selectOption({ label: "Ceilings – roll & cut" });
    // Make the ceiling an optional upgrade
    await page.getByRole("button", { name: /Ceilings – roll & cut/ }).click();
    await page.getByLabel("Colour").fill("SW 7008 Alabaster");
    await page.getByText("Optional upgrade").click();
    await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });

    // Send (link only; email isn't configured in tests)
    await page.getByRole("button", { name: "Send proposal" }).click();
    await page.getByText("Email it to the customer").click();
    await page.getByLabel("Personal message (optional)").fill("Great meeting you – here's your quote.");
    await page.getByRole("button", { name: "Create link" }).click();
    const link = await page.getByLabel("Proposal link").inputValue();
    expect(link).toMatch(/\/share\/p\/[A-Za-z0-9_-]{20,}/);

    // Customer (no login) opens it
    const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const cp = await customer.newPage();
    const res = await cp.goto(link);
    const html = (await res?.text()) ?? "";
    for (const secret of ["laborCostPerHour", "billingRatePerHour", "targetMargin", "internalNotes", "rateSnapshot", "pricePerGallon"]) {
      expect(html, `public page must not contain ${secret}`).not.toContain(secret);
    }
    await expect(cp.getByRole("heading", { name: "Interior repaint" })).toBeVisible();
    await expect(cp.getByText("Great meeting you")).toBeVisible();
    await expect(cp.getByText("Walls – roll & cut")).toBeVisible();
    const before = await cp.locator("dt:has-text('Total') + dd").innerText();
    await cp.getByRole("checkbox", { name: /Ceilings – roll & cut/ }).check();
    await expect(cp.locator("dt:has-text('Total') + dd")).not.toHaveText(before);

    // Sign
    await cp.getByLabel("Full name").fill("Pat Customer");
    const pad = cp.getByLabel(/Signature pad/);
    await pad.scrollIntoViewIfNeeded();
    const box = (await pad.boundingBox())!;
    await cp.mouse.move(box.x + 20, box.y + 60);
    await cp.mouse.down();
    for (let i = 1; i <= 12; i++) await cp.mouse.move(box.x + 20 + i * 18, box.y + 60 + (i % 2 ? -20 : 20));
    await cp.mouse.up();
    await cp.getByText(/I have read and accept/).click();
    await cp.getByRole("button", { name: /Accept & sign/ }).click();
    await expect(cp.getByText("Accepted – thank you!")).toBeVisible();
    await customer.close();

    // Staff side: project created, estimate locked
    await page.reload();
    await expect(page.getByText(/project #\d+ was created automatically/)).toBeVisible();
    await expect(page.getByText("Accepted – locked")).toBeVisible();
    await page.getByText(/project #\d+ was created automatically/).click();
    await expect(page.getByRole("heading", { name: /Proposal Test/ })).toBeVisible();
    await expect(page.getByText("Pat Customer")).toBeVisible();
  });

  test("painters cannot see projects", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: statePath("painter") });
    const p = await ctx.newPage();
    await p.goto("/projects");
    await expect(p).toHaveURL(/no-access|my-jobs/);
    await ctx.close();
  });
});

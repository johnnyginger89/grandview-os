import { expect, test, type Browser, type Page } from "@playwright/test";
import { statePath } from "./helpers";
import { draftThreeThousandDollarEstimate } from "./sales";

/*
 * The office hears about it when a customer opens or accepts a proposal: in the bell
 * (and on their phone when they've switched that on). Amounts only go to people who
 * may see company financials, and each person only ever sees their own notices.
 */
test.describe.configure({ mode: "serial" });

interface Notice {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
}

async function notices(page: Page): Promise<Notice[]> {
  const res = await page.request.get("/api/notifications");
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { items: Notice[] }).items;
}

/** Notices are written just after the customer's page is sent, so allow a moment. */
async function waitForNotice(page: Page, title: string): Promise<Notice> {
  let found: Notice | undefined;
  await expect(async () => {
    found = (await notices(page)).find((n) => n.title === title);
    expect(found).toBeTruthy();
  }).toPass({ timeout: 15_000 });
  return found!;
}

async function createLink(page: Page) {
  await page.getByRole("button", { name: "Send proposal" }).click();
  await page.getByText("Email it to the customer").click();
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Proposal link").inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  return link;
}

/** A real visit: the page is counted once the customer is looking at it (here, scrolling). */
async function openAsCustomer(browser: Browser, link: string) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const cp = await ctx.newPage();
  await cp.goto(link);
  await expect(cp.getByRole("button", { name: /^Accept – \$/ }).first()).toBeVisible();
  const counted = cp.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/share/p/"));
  await cp.mouse.wheel(0, 300);
  await counted;
  await ctx.close();
}

async function acceptOnline(browser: Browser, link: string) {
  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const cp = await customer.newPage();
  await cp.goto(link);
  await cp.getByLabel("Full name").fill("Notice Customer");
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
}

test.describe("as the owner", () => {
  test.use({ storageState: statePath("owner") });

  test("the bell says when a customer opens and accepts their proposal", async ({ page, browser }) => {
    const name = await draftThreeThousandDollarEstimate(page);
    const estimatePath = new URL(page.url()).pathname;
    const link = await createLink(page);

    // A link preview (texting the link builds one) fetches the page but isn't the customer opening it.
    const preview = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    expect((await preview.request.get(link)).ok()).toBeTruthy();
    await preview.close();
    await page.reload();
    await expect(page.locator("#proposals").getByText("Not opened yet")).toBeVisible();

    await openAsCustomer(browser, link);
    const opened = await waitForNotice(page, `${name} opened their proposal`);
    expect(opened.href).toBe(estimatePath);
    expect(opened.read).toBe(false);

    // It shows in the bell, and clicking it opens the estimate and marks it read.
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Notifications, \d+ new$/ }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Notifications/ }).first().click();
    const panel = page.getByRole("group", { name: "Notifications" });
    await panel.getByRole("link", { name: new RegExp(`${name.replace(/[[\]]/g, "\\$&")} opened their proposal`) }).click();
    await expect(page).toHaveURL(new RegExp(`${estimatePath}$`));
    await expect.poll(async () => (await notices(page)).find((n) => n.id === opened.id)?.read).toBe(true);

    await page.reload();
    await expect(page.locator("#proposals").getByText(/Opened 1×/)).toBeVisible();

    // Opening it again straight away isn't news.
    await openAsCustomer(browser, link);

    await acceptOnline(browser, link);
    const accepted = await waitForNotice(page, `${name} accepted their proposal`);
    expect(accepted.body).toContain("$3,000.00 + GST");
    expect(accepted.body).toContain("The job has been created.");
    // It says the job was created, so it opens the job.
    expect(accepted.href).toMatch(/^\/projects\/[0-9a-f-]{36}$/);
    expect((await notices(page)).filter((n) => n.title === `${name} opened their proposal again`)).toHaveLength(0);
  });

  test("Mark all read clears the count", async ({ page }) => {
    await page.goto("/");
    const bell = page.getByRole("button", { name: /^Notifications/ }).first();
    await bell.click();
    const panel = page.getByRole("group", { name: "Notifications" });
    const markAll = panel.getByRole("button", { name: "Mark all read" });
    if (await markAll.isVisible()) await markAll.click();
    await expect(bell).toHaveAccessibleName("Notifications");
    await expect.poll(async () => (await notices(page)).some((n) => !n.read)).toBe(false);
  });
});

test.describe("as an estimator", () => {
  test.use({ storageState: statePath("estimator") });

  test("the person who prepared it is told too, without the amount, and nobody else's notices leak", async ({ page, browser }) => {
    const name = await draftThreeThousandDollarEstimate(page);
    const estimatePath = new URL(page.url()).pathname;
    const link = await createLink(page);
    await acceptOnline(browser, link);

    const accepted = await waitForNotice(page, `${name} accepted their proposal`);
    expect(accepted.body).toContain("The job has been created.");
    expect(accepted.body).not.toContain("$");
    // Estimators can't open jobs, so theirs opens the estimate.
    expect(accepted.href).toBe(estimatePath);

    // The owner hears about it with the amount.
    const owner = await browser.newContext({ storageState: statePath("owner") });
    const ownerPage = await owner.newPage();
    const ownerNotice = await waitForNotice(ownerPage, `${name} accepted their proposal`);
    expect(ownerNotice.body).toContain("$3,000.00 + GST");
    expect(ownerNotice.href).toMatch(/^\/projects\/[0-9a-f-]{36}$/);
    // …and this estimator never sees the owner's own notices.
    const mine = await notices(page);
    expect(mine.some((n) => n.id === ownerNotice.id)).toBe(false);
    await owner.close();

    // A painter has nothing about sales.
    const painter = await browser.newContext({ storageState: statePath("painter") });
    const painterPage = await painter.newPage();
    expect((await notices(painterPage)).some((n) => n.title.includes(name))).toBe(false);
    await painter.close();
  });
});

test("signed-out visitors can't read notifications", async ({ browser }) => {
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const res = await anon.request.get("/api/notifications");
  expect(res.status()).toBe(401);
  const read = await anon.request.post("/api/notifications/read", { data: { all: true } });
  expect(read.status()).toBe(401);
  await anon.close();
});

import { expect, test } from "@playwright/test";
import { expectNoAccess, statePath } from "./helpers";
import { sellThreeThousandDollarJob } from "./sales";

/*
 * Schedule (spec-schedule §9.2, core path): set up a crew, book a signed job from the
 * project page, see it on the calendar, and check what each role can see. The steps
 * share one job, so the file runs in order.
 */
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const CREW = `[TEST DATA] Sub ${stamp}`;
const NOTE = `Start with the back deck ${stamp}`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let projectPath = "";
let projectNumber = "";
let startDate = "";

/** A Monday about three weeks out, as YYYY-MM-DD in Vancouver. */
function futureMonday(): string {
  const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(new Date()) + "T00:00:00Z");
  const d = new Date(today.getTime() + 21 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

test.describe("schedule (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("add a crew with a field login as lead", async ({ page }) => {
    await page.goto("/schedule/setup");
    await page.getByRole("button", { name: "Add crew" }).click();
    const form = page.getByRole("form", { name: "Add crew" });
    await form.getByLabel("Name").fill(CREW);
    await form.getByLabel("Type").selectOption({ label: "Subcontractor" });
    await form.getByLabel("Crew size").fill("2");
    await form.getByLabel("Hours per day").fill("8");
    await form.getByRole("checkbox", { name: "Subcontractor (Dev)" }).check();
    await form.getByRole("button", { name: "Crew lead: Subcontractor (Dev)" }).click();
    await form.getByRole("button", { name: "Save crew" }).click();
    await expect(page.getByRole("table", { name: "Crews" }).getByText(CREW).first()).toBeVisible();
    await expect(page.getByRole("switch", { name: `Active: ${CREW}` })).toHaveAttribute("aria-checked", "true");
  });

  test("book a signed job from the project page and see it on the calendar", async ({ page, browser }) => {
    const name = await sellThreeThousandDollarJob(page, browser);
    await page.goto("/projects");
    await page.getByRole("link", { name: new RegExp(escape(name)) }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    projectPath = new URL(page.url()).pathname;
    projectNumber = (await page.getByRole("heading", { level: 1 }).innerText()).match(/#(\d+)/)![1];

    await page.getByRole("button", { name: "Schedule this job" }).click();
    const form = page.getByRole("form", { name: "Schedule this job" });
    await form.getByLabel("Crew").selectOption({ label: CREW });
    startDate = futureMonday();
    await form.getByLabel("Start date").fill(startDate);
    await form.getByLabel("Working days").fill("2");
    await form.getByLabel("Notes the painters will see (optional)").fill(NOTE);
    await form.getByRole("button", { name: "Add to schedule" }).click();
    await expect(page.getByRole("status").filter({ hasText: /./ }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).getByText("Scheduled", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "Bookings" }).getByText(CREW)).toBeVisible();

    await page.goto(`/schedule?view=timeline&from=${startDate}&span=14`);
    await expect(page.getByTestId("schedule-timeline")).toBeVisible();
    const bar = page.getByRole("button", { name: new RegExp(`Job #${projectNumber}\\b`) }).first();
    await expect(bar).toBeVisible();
    await bar.click();
    const drawer = page.getByTestId("entry-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("project-status")).toHaveText("Scheduled");
    await expect(drawer.getByText(NOTE)).toBeVisible();

    // The month is the main view: the same booking shows there as a solid crew-coloured bar.
    await page.goto(`/schedule?from=${startDate}`);
    const month = page.locator('[data-testid="schedule-board"][data-layout="desktop"]').getByTestId("schedule-month");
    await expect(month).toBeVisible();
    const monthBar = month.getByRole("button", { name: new RegExp(`Job #${projectNumber}\\b`) }).first();
    await expect(monthBar).toBeVisible();
    expect(await monthBar.evaluate((el) => getComputedStyle(el).borderStyle)).not.toContain("dashed");
  });

  test("issue a work order for the crew", async ({ page }) => {
    test.skip(!projectPath, "needs the booking above");
    await page.goto(projectPath);
    const card = page.getByRole("region", { name: "Work orders" });
    await card.getByRole("button", { name: "New work order" }).click();
    const form = page.getByRole("dialog", { name: "New work order" });
    await form.getByLabel("Crew", { exact: true }).selectOption({ label: CREW });
    await form.getByRole("button", { name: "Create work order" }).click();
    await expect(card.getByText(/Work order created/)).toBeVisible();
    await card.getByTestId("work-order").first().getByRole("button", { name: "Issue", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Issue work order" }).click();
    await expect(card.getByText("Version 1 issued.")).toBeVisible();
  });
});

test.describe("schedule (subcontractor crew lead)", () => {
  test.use({ storageState: statePath("subcontractor") });

  test("My Jobs shows the booked job with directions and no money", async ({ page }) => {
    test.skip(!projectNumber, "needs the owner steps above");
    await page.goto("/my-jobs");
    const job = page.getByRole("article").filter({ hasText: `#${projectNumber}` });
    await expect(job).toBeVisible();
    await expect(job.getByText("1 Example St").first()).toBeVisible();
    await expect(job.getByRole("link", { name: "Open in Maps" })).toBeVisible();
    await expect(job.getByText(NOTE)).toBeVisible();
    const html = await page.content();
    // "Subcontractor" (the role name) is fine; the word "contract" on its own is not.
    expect(html).not.toMatch(/\bcontract\b/i);
    for (const secret of ["estimatedHours", "depositRequired", "estimatedCost", "totalPrice"]) expect(html, secret).not.toContain(secret);
    expect(await page.locator("main").innerText()).not.toContain("$");

    await job.getByRole("link", { name: "Work order" }).click();
    await expect(page).toHaveURL(/\/my-jobs\/work-orders\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("$");

    await expectNoAccess(page, "/schedule");
  });
});

test.describe("schedule (painter)", () => {
  test.use({ storageState: statePath("painter") });

  test("painters not on the crew don't see the job or the calendar", async ({ page }) => {
    test.skip(!projectNumber, "needs the owner steps above");
    await page.goto("/my-jobs");
    await expect(page.getByText(`#${projectNumber}`)).toHaveCount(0);
    await expectNoAccess(page, "/schedule");
    await expectNoAccess(page, "/schedule/setup");
  });
});

test.describe("schedule (estimator)", () => {
  test.use({ storageState: statePath("estimator") });

  test("estimators can look at the calendar but not change it", async ({ page }) => {
    test.skip(!startDate, "needs the owner steps above");
    await page.goto(`/schedule?view=timeline&from=${startDate}&span=14`);
    await expect(page.getByRole("button", { name: new RegExp(`Job #${projectNumber}\\b`) }).first()).toBeVisible();
    await expect(page.getByLabel(/^Drag #/)).toHaveCount(0);
    await expect(page.getByLabel("Change end date")).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(`Job #${projectNumber}\\b`) }).first().click();
    await expect(page.getByTestId("entry-drawer")).toBeVisible();
    await expect(page.getByRole("button", { name: /Send start week/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove from schedule" })).toHaveCount(0);
    await expectNoAccess(page, "/schedule/setup");
  });
});

test.describe("schedule cleanup (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("remove the booking and turn the test crew off", async ({ page }) => {
    test.skip(!startDate, "needs the owner steps above");
    await page.goto(`/schedule?view=timeline&from=${startDate}&span=14`);
    await page.getByRole("button", { name: new RegExp(`Job #${projectNumber}\\b`) }).first().click();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("entry-drawer").getByRole("button", { name: "Remove from schedule" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`Job #${projectNumber}\\b`) })).toHaveCount(0);

    await page.goto("/schedule/setup");
    const active = page.getByRole("switch", { name: `Active: ${CREW}` });
    await active.click();
    await expect(active).toHaveAttribute("aria-checked", "false");
  });
});

import { expect, test, type Page } from "@playwright/test";
import { expectNoAccess, statePath } from "./helpers";
import { sellThreeThousandDollarJob } from "./sales";

/*
 * Crew work orders (spec-work-orders §5): made automatically when the job is sold,
 * someone assigned from the card, issued, shared by link with labour hours and paint
 * to order but no money anywhere, a new version with a highlighted change, revoke,
 * and painters kept out. The steps share one job, so the file runs in order.
 */
test.describe.configure({ mode: "serial" });

const COLOUR = "SW 7008 Alabaster";
const FIRST = "Start in the living room.";
const SECOND = "Start in the kitchen instead.";
// Its own crew without the painter, so "painters kept out" holds whatever crews other files made.
const CREW = `[TEST DATA] Work order crew ${Date.now()}`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let projectPath = "";
let shareLink = "";
let workOrderId = "";

const card = (page: Page) => page.getByRole("region", { name: "Work orders" });
const row = (page: Page) => card(page).getByTestId("work-order").first();

async function openAnonymously(browser: import("@playwright/test").Browser, url: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const res = await page.goto(url);
  return { context, page, res };
}

test.describe("work orders (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("selling the job creates its work order, someone is assigned, and it's issued", async ({ page, browser }) => {
    const name = await sellThreeThousandDollarJob(page, browser, { colour: COLOUR, internalNote: "SECRET-INTERNAL note for the office", size: { length: "15", width: "12" } });
    await page.goto("/schedule/setup");
    await page.getByRole("button", { name: "Add crew" }).click();
    const crewForm = page.getByRole("form", { name: "Add crew" });
    await crewForm.getByLabel("Name").fill(CREW);
    await crewForm.getByLabel("Crew size").fill("1");
    await crewForm.getByRole("checkbox", { name: "Crew Leader (Dev)" }).check();
    await crewForm.getByRole("button", { name: "Save crew" }).click();
    await expect(page.getByRole("table", { name: "Crews" }).getByText(CREW).first()).toBeVisible();

    await page.goto("/projects");
    await page.getByRole("link", { name: new RegExp(escape(name)) }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    projectPath = new URL(page.url()).pathname;

    // Already there: a draft for all crews, with the default checklist.
    await expect(card(page).getByTestId("work-order")).toHaveCount(1);
    await expect(row(page).getByText("All crews")).toBeVisible();
    await expect(row(page).getByText("Draft", { exact: true })).toBeVisible();
    await expect(row(page).getByText(/Not issued yet/)).toBeVisible();
    await expect(row(page).getByTestId("work-order-assigned")).toContainText("Nobody is booked on this job yet.");

    // Booking someone from the card is what assigns them.
    await card(page).getByRole("button", { name: "Assign someone" }).click();
    const assign = card(page).getByRole("form", { name: "Assign someone" });
    await assign.getByLabel("Who").selectOption({ label: CREW });
    await assign.getByLabel("What they're doing").selectOption({ label: "Colour consult" });
    await assign.getByLabel("Working days").fill("1");
    await assign.getByRole("button", { name: "Add to schedule" }).click();
    await expect(row(page).getByTestId("work-order-assigned")).toContainText("Colour consult ·");

    await row(page).getByRole("button", { name: "Edit" }).click();
    const form = page.getByRole("dialog");
    await expect(form.getByLabel("Checklist item 1", { exact: true })).not.toHaveValue("");
    await form.getByLabel("Special instructions").fill(`${FIRST}\n- Dog in the yard`);
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(card(page).getByText(/Changes saved/)).toBeVisible();

    await row(page).getByRole("button", { name: "Issue", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Issue work order" }).click();
    await expect(card(page).getByText("Version 1 issued.")).toBeVisible();
    await expect(row(page).getByText("Issued", { exact: true })).toBeVisible();
    await expect(row(page).getByText(/Version 1, issued/)).toBeVisible();

    const preview = await row(page).getByRole("link", { name: "Preview" }).getAttribute("href");
    workOrderId = preview!.split("?")[0].split("/").at(-1)!;
    expect(workOrderId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("a share link shows the crew the job and nothing about money", async ({ page, browser }) => {
    await page.goto(projectPath);
    await row(page).getByRole("button", { name: "Create link" }).click();
    const dialog = page.getByRole("dialog");
    // Crews see the estimated hours on purpose, so the dialog mustn't promise otherwise.
    await expect(dialog).toContainText("including any estimated hours but never prices");
    await dialog.getByLabel("Who is it for?").fill("[TEST DATA] Niko's crew");
    await dialog.getByLabel("Link works for").selectOption("30");
    await dialog.getByRole("button", { name: "Create link" }).click();
    shareLink = await dialog.getByLabel("Work order link").inputValue();
    expect(shareLink).toMatch(/\/share\/wo\/[A-Za-z0-9_-]{43}$/);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(row(page).getByTestId("work-order-link").getByText("[TEST DATA] Niko's crew")).toBeVisible();

    const crew = await openAnonymously(browser, shareLink);
    expect(crew.res?.status()).toBe(200);
    const p = crew.page;
    await expect(p.getByText("Work order", { exact: true })).toBeVisible();
    await expect(p.getByRole("heading", { name: "Address and access" })).toBeVisible();
    await expect(p.getByText("1 Example St").first()).toBeVisible();
    await expect(p.getByRole("link", { name: "Open in Maps" })).toBeVisible();
    await expect(p.getByText("Walls – roll & cut").first()).toBeVisible();
    await expect(p.getByText("2 coats").first()).toBeVisible();
    await expect(p.locator('[data-section="scope"]').getByText(`Colour: ${COLOUR}`)).toBeVisible();
    await expect(p.getByRole("heading", { name: "Special instructions" })).toBeVisible();
    await expect(p.getByText(FIRST)).toBeVisible();
    await expect(p.getByText("Dog in the yard")).toBeVisible();
    await expect(p.getByRole("heading", { name: "Checklist" })).toBeVisible();
    await expect(p.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(p.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    // Hours and paint to buy, as the owner asked; never what anything costs.
    await expect(p.getByText(/Estimated labour: [\d.,]+ hours/)).toBeVisible();
    await expect(p.getByRole("heading", { name: "Paint to order" })).toBeVisible();
    await expect(p.getByRole("list", { name: "Paint to order" })).toContainText(/\d+ (gal|qt)/);
    await expect(p.getByRole("list", { name: "Paint to order" })).toContainText(`Colour: ${COLOUR}`);
    await expect(p.locator('[data-section="bookings"]')).toContainText("Colour consult");

    const html = (await crew.res?.text()) ?? "";
    for (const secret of ["SECRET-INTERNAL", "price", "laborCostPerHour", "billingRatePerHour", "rateSnapshot", "overrideHours", "pricePerGallon"]) expect(html, secret).not.toContain(secret);
    // React and Next use "$" in their own inline scripts and <!--$--> markers; the page itself must not contain one.
    expect(html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<!--[\s\S]*?-->/g, "")).not.toContain("$");
    expect(await p.locator("body").innerText()).not.toContain("$");
    await crew.context.close();

    await page.reload();
  });

  test("issuing version 2 shows the crew what changed", async ({ page, browser }) => {
    await page.goto(projectPath);
    await row(page).getByRole("button", { name: "Edit" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Special instructions").fill(SECOND);
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(card(page).getByText(/Changes saved/)).toBeVisible();
    await expect(row(page).getByText(/not issued yet: Special instructions/)).toBeVisible();

    await row(page).getByRole("button", { name: "Issue new version" }).click();
    const issue = page.getByRole("dialog", { name: "Issue version 2" });
    await issue.getByLabel("What changed? (optional)").fill("Start room changed");
    await issue.getByRole("button", { name: "Issue version 2" }).click();
    await expect(card(page).getByText("Version 2 issued.")).toBeVisible();

    const crew = await openAnonymously(browser, shareLink);
    const p = crew.page;
    await expect(p.getByText(/^Updated .+: version 2 replaces version 1\.$/)).toBeVisible();
    await expect(p.getByText("Check the highlighted sections.")).toBeVisible();
    await expect(p.getByText(SECOND)).toBeVisible();
    await expect(p.getByText(FIRST)).toHaveCount(0);
    const changed = p.locator('[data-section="specialInstructions"]');
    await expect(changed).toHaveAttribute("data-changed", "true");
    await expect(changed.getByText("Changed", { exact: true })).toBeVisible();
    await expect(p.locator('[data-section="scope"]')).not.toHaveAttribute("data-changed", "true");
    await crew.context.close();

    await page.reload();
  });

  test("the project manager picked on the job is the office contact on the next version and joins the chat", async ({ page }) => {
    await page.goto(projectPath);
    const picker = page.getByLabel("Project manager", { exact: true });
    await expect(picker).toHaveValue("");
    await picker.selectOption({ label: "Project Manager (Dev)" });
    await expect(page.getByRole("status").filter({ hasText: "Project manager saved" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Project manager", { exact: true }).locator("option:checked")).toHaveText("Project Manager (Dev)");

    // Version 2 keeps what it said; the next version names the office contact.
    await expect(row(page).getByText(/not issued yet: Job details/)).toBeVisible();
    const preview = await row(page).getByRole("link", { name: "Preview" }).getAttribute("href");
    await page.goto(preview!);
    await expect(page.locator("dl").filter({ hasText: "Office contact" })).toContainText("Project Manager (Dev)");

    await page.goto(projectPath);
    await page.getByRole("region", { name: "Job chat" }).getByRole("link", { name: "Open chat" }).click();
    await page.getByRole("button", { name: /^People in this chat/ }).click();
    const members = page.getByRole("dialog", { name: "People in this chat" }).getByRole("list", { name: "Members" });
    await expect(members).toContainText("Project Manager (Dev)");
    await expect(members).toContainText("Project manager");
  });

  test("a revoked link stops working at once", async ({ page, browser }) => {
    await page.goto(projectPath);
    page.once("dialog", (d) => d.accept());
    await row(page).getByRole("button", { name: /^Revoke link for/ }).click();
    await expect(card(page).getByText(/Link turned off/)).toBeVisible();
    await expect(row(page).getByText("Turned off", { exact: true })).toBeVisible();

    const crew = await openAnonymously(browser, shareLink);
    expect(crew.res?.status()).toBe(404);
    await expect(crew.page.getByText("This work order link has expired or been turned off. Ask the office for a new one.")).toBeVisible();
    await expect(crew.page.getByText(SECOND)).toHaveCount(0);
    await crew.context.close();
  });
});

test.describe("work orders (painter)", () => {
  test.use({ storageState: statePath("painter") });

  test("painters can't open the job or a work order for a crew they aren't on", async ({ page }) => {
    test.skip(!projectPath || !workOrderId, "needs the owner steps above");
    await expectNoAccess(page, projectPath);
    await page.goto(`/my-jobs/work-orders/${workOrderId}`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByText(SECOND)).toHaveCount(0);
    // The "Work order" button on /my-jobs needs the painter booked in a crew, which this file doesn't set up.
  });
});

import { expect, test, type Page } from "@playwright/test";
import { expectNoAccess, statePath } from "./helpers";
import { sellThreeThousandDollarJob } from "./sales";

/*
 * The colour selection form: the office fills it in from the signed estimate, sends the
 * customer a link, the customer ticks both notes and signs, and the colours land on the
 * job's readiness, its work order, the customer file and the colour consultant's phone.
 */
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const CONSULTANT = `[TEST DATA] Colours ${stamp}`;
let projectPath = "";
let customerName = "";
let formPath = "";
let link = "";

const coloursCard = (page: Page) => page.getByRole("region", { name: "Colours" });

async function sign(page: Page) {
  const pad = page.getByLabel(/Signature pad/);
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 20 + i * 18, box.y + 60 + (i % 2 ? -20 : 20));
  await page.mouse.up();
}

test.describe("colour form (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("fill in colours from the estimate and send the customer a link", async ({ page, browser }) => {
    customerName = await sellThreeThousandDollarJob(page, browser, { size: { length: "15", width: "12" } });
    await page.goto("/projects");
    await page.getByRole("link", { name: new RegExp(customerName.replace(/[[\]]/g, "\\$&")) }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    projectPath = new URL(page.url()).pathname;

    // A colour consultant with a field login, booked on the job.
    await page.goto("/schedule/setup");
    await page.getByRole("button", { name: "Add crew" }).click();
    const crew = page.getByRole("form", { name: "Add crew" });
    await crew.getByLabel("Name").fill(CONSULTANT);
    await crew.getByLabel("Crew size").fill("1");
    await crew.getByRole("checkbox", { name: "Painter (Dev)" }).check();
    await crew.getByRole("button", { name: "Crew lead: Painter (Dev)" }).click();
    await crew.getByRole("button", { name: "Save crew" }).click();
    await expect(page.getByRole("table", { name: "Crews" }).getByText(CONSULTANT).first()).toBeVisible();
    await page.goto(projectPath);
    await page.getByRole("button", { name: "Assign someone" }).click();
    const assign = page.getByRole("form", { name: "Assign someone" });
    await assign.getByLabel("Who").selectOption({ label: CONSULTANT });
    await assign.getByLabel("What they're doing").selectOption({ label: "Colour consult" });
    await assign.getByLabel("Working days").fill("1");
    await assign.getByRole("button", { name: "Add to schedule" }).click();
    await expect(page.getByTestId("work-order-assigned").first()).toContainText(`Colour consult · ${CONSULTANT}`);

    await expect(coloursCard(page).getByText("No colours yet.")).toBeVisible();
    await coloursCard(page).getByRole("button", { name: "Fill in colours" }).click();
    await expect(page).toHaveURL(/\/colours\/[0-9a-f-]{36}$/);
    formPath = new URL(page.url()).pathname;

    // The estimate's walls are already listed.
    await expect(page.getByLabel("Room, line 1")).toHaveValue("Living room");
    await expect(page.getByLabel("Surface, line 1")).toHaveValue("Walls");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(/@example\.com$/);
    await page.getByLabel("Colour, line 1").fill("Alabaster");
    await page.getByLabel("Colour code, line 1").fill("SW 7008");
    await page.getByLabel("Sheen, line 1").fill("Eggshell");
    await page.getByRole("button", { name: "Add a line" }).click();
    await page.getByLabel("Room, line 2").fill("Front door");
    await page.getByLabel("Surface, line 2").fill("Door");
    await page.getByLabel("Colour, line 2").fill("Hale Navy");
    await page.getByLabel("Colour code, line 2").fill("HC-154");
    await page.getByLabel("Sheen, line 2").fill("Gloss");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await page.goto(projectPath);
    await expect(coloursCard(page).getByText("Being filled in")).toBeVisible();
    await coloursCard(page).getByRole("button", { name: "Send to customer" }).click();
    const dialog = page.getByRole("dialog", { name: "Send the colour form" });
    await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(/\[Colour form link\]/);
    await dialog.getByRole("button", { name: "Send" }).click();
    const ready = page.getByRole("dialog", { name: "Colour form link ready" });
    await expect(ready.getByText(/Email isn't connected yet/)).toBeVisible();
    link = await ready.getByLabel("Colour form link").inputValue();
    expect(link).toMatch(/\/share\/c\/[A-Za-z0-9_-]{43}$/);
    await ready.getByRole("button", { name: "Done" }).click();
    await expect(coloursCard(page).getByText("Sent to the customer")).toBeVisible();
  });

  test("the customer signs through the link, after ticking both notes", async ({ browser }) => {
    test.skip(!link, "needs the link above");
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    const res = await p.goto(link);
    expect(res?.status()).toBe(200);
    await expect(p.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(p.getByRole("heading", { name: "Colour selections" })).toBeVisible();
    await expect(p.getByLabel("Colour, line 1")).toHaveValue("Alabaster");
    await expect(p.getByLabel("Colour, line 2")).toHaveValue("Hale Navy");
    await p.getByLabel("Sheen, line 2").fill("Semi-gloss");

    await p.getByLabel("Your full name").fill("Kim Lee");
    await sign(p);
    await p.getByRole("button", { name: "Sign and submit colours" }).click();
    await expect(p.getByRole("alert").filter({ hasText: "changing colours" })).toBeVisible();
    const ticks = p.getByRole("checkbox", { name: "I understand" });
    await ticks.nth(0).check();
    await ticks.nth(1).check();
    await p.getByRole("button", { name: "Sign and submit colours" }).click();
    await expect(p.getByText(/Signed by Kim Lee on/)).toBeVisible();
    await expect(p.getByRole("table", { name: "Signed colours" })).toContainText("HC-154 Hale Navy");
    await expect(p.getByRole("table", { name: "Signed colours" })).toContainText("Semi-gloss");
    // Signed is final: the same link shows the signed copy, with nothing to edit.
    await p.reload();
    await expect(p.getByRole("button", { name: "Sign and submit colours" })).toHaveCount(0);
    await ctx.close();
  });

  test("the job, its work order and the customer file have the colours", async ({ page }) => {
    test.skip(!link, "needs the signing above");
    await page.goto(projectPath);
    await expect(coloursCard(page).getByText(/Signed by Kim Lee on .* \(online\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Change colours" })).toBeVisible();
    // Signing ticked off the colour consult.
    await expect(page.getByRole("list", { name: "Readiness checks" }).getByLabel("Colour consult")).toHaveValue("done");

    const preview = await page.getByTestId("work-order").first().getByRole("link", { name: "Preview" }).getAttribute("href");
    await page.goto(preview!);
    const colours = page.locator('[data-section="colours"]');
    await expect(colours).toContainText("SW 7008 Alabaster");
    await expect(colours).toContainText("HC-154 Hale Navy");
    await expect(page.locator('[data-section="scope"]').getByText("Colour: SW 7008 Alabaster")).toBeVisible();
    await expect(page.getByRole("list", { name: "Paint to order" })).toContainText("Colour: SW 7008 Alabaster · Sheen: Eggshell");

    await page.goto(projectPath);
    await page.getByRole("link", { name: customerName }).first().click();
    await expect(page.getByRole("region", { name: "Colour selections" })).toContainText("Signed by Kim Lee");
  });
});

test.describe("colour form (colour consultant)", () => {
  test.use({ storageState: statePath("painter") });

  test("the booked consultant opens it from My Jobs, but never the office's job page", async ({ page }) => {
    test.skip(!formPath, "needs the owner steps above");
    await page.goto("/my-jobs");
    const job = page.getByRole("article").filter({ hasText: CONSULTANT });
    await job.getByRole("link", { name: "Colour form" }).click();
    await expect(page.getByText(/Signed by Kim Lee on/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Change colours" })).toBeVisible();
    await expectNoAccess(page, formPath);
  });
});

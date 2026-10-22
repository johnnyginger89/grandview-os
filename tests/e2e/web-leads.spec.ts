import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { parse } from "dotenv";
import { expectNoAccess, statePath } from "./helpers";

/*
 * Website form leads and YouCanBook.me bookings are never lost: one bad field doesn't
 * stop a lead, what can't be imported waits under Leads → "Couldn't import" with Retry
 * and Dismiss, and the office hears about each one.
 */

function secret(name: string): string {
  if (process.env[name]) return process.env[name]!;
  try {
    return parse(readFileSync(".env"))[name] ?? "";
  } catch {
    return "";
  }
}
const FORM_SECRET = secret("FORM_WEBHOOK_SECRET");
const YCBM_SECRET = secret("YCBM_WEBHOOK_SECRET");

const postForm = (request: APIRequestContext, data: Record<string, string>, key = FORM_SECRET) =>
  request.post("/api/inbound/form", { headers: { "x-webhook-secret": key }, data });
const postBooking = (request: APIRequestContext, data: Record<string, string>) =>
  request.post("/api/inbound/youcanbookme", { headers: { "x-webhook-secret": YCBM_SECRET }, data });

interface Notice {
  title: string;
  body: string | null;
  href: string | null;
}

/** Notices are written just after the webhook is answered, so allow a moment. */
async function waitForNotice(page: Page, match: (n: Notice) => boolean): Promise<Notice> {
  let found: Notice | undefined;
  await expect(async () => {
    const res = await page.request.get("/api/notifications");
    found = ((await res.json()) as { items: Notice[] }).items.find(match);
    expect(found).toBeTruthy();
  }).toPass({ timeout: 15_000 });
  return found!;
}

/** A 10-digit phone number unique to this run, so the customer match is ours. */
const phoneFor = (stamp: number) => `778-${String(stamp).slice(-7, -4)}-${String(stamp).slice(-4)}`;

test.describe("as the owner", () => {
  test.use({ storageState: statePath("owner") });

  test("a website lead with nothing to say who sent it waits under Couldn't import, with Retry and Dismiss", async ({ page }) => {
    expect(FORM_SECRET, "FORM_WEBHOOK_SECRET in .env").not.toBe("");
    expect((await postForm(page.request, { message: "x" }, "wrong-secret-wrong-secret")).status()).toBe(401);

    const message = `[TEST DATA] Please call me about my deck ${Date.now()}`;
    const res = await postForm(page.request, { message, city: "Surrey" });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toContain("no name, email or phone number");
    const notice = await waitForNotice(page, (n) => n.title === "A website lead couldn't be imported");
    expect(notice.href).toBe("/leads/not-imported");

    await page.goto("/leads");
    await expect(page.getByText(/web leads? couldn't be imported/)).toBeVisible();
    await page.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(/\/leads\/not-imported$/);
    await expect(page.getByRole("heading", { name: "Couldn't import" })).toBeVisible();

    const row = page.getByRole("listitem").filter({ hasText: message });
    await expect(row).toContainText("Website form");
    await expect(row).toContainText("Why: It has no name, email or phone number");

    // Retry runs it again; with nothing to go on it still can't be imported, so it stays.
    await row.getByRole("button", { name: "Retry" }).click();
    await expect(row.getByRole("alert")).toContainText("Still couldn't import it");
    await expect(row).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("main").getByRole("status")).toContainText("dismissed.");
    await expect(page.getByRole("listitem").filter({ hasText: message })).toHaveCount(0);
  });

  test("a bad email or a long message doesn't stop a website lead, and sending the form again adds to it", async ({ page }) => {
    const stamp = Date.now();
    const name = `Web Lead ${stamp} [TEST DATA]`;
    const phone = phoneFor(stamp);
    const first = await postForm(page.request, { name, email: "web-lead-at-example", phone, service: "Interior", city: "Surrey", message: "Please paint the whole house. ".repeat(80) });
    expect(first.status()).toBe(200);
    const { opportunityId } = (await first.json()) as { opportunityId: string };
    await waitForNotice(page, (n) => n.title === `New web lead: ${name}`);

    await page.goto(`/leads/${opportunityId}`);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Email as received: web-lead-at-example")).toBeVisible();
    await expect(page.getByText(/Too long to keep in full, so shortened: message/)).toBeVisible();

    // Same person again (matched by phone): no second lead, the message and the missing email are added.
    const again = await postForm(page.request, { name, email: `web-${stamp}@example.com`, phone, message: `Also the fence ${stamp}` });
    expect(((await again.json()) as { opportunityId: string }).opportunityId).toBe(opportunityId);
    await waitForNotice(page, (n) => n.title === `${name} sent the website form again`);
    await page.reload();
    await expect(page.getByRole("link", { name: `web-${stamp}@example.com` })).toBeVisible();
    await expect(page.getByText("New inquiry from the website form – added to this lead")).toBeVisible();
    await expect(page.getByText(`Email added: web-${stamp}@example.com`)).toBeVisible();
    await expect(page.getByText(`Also the fence ${stamp}`).first()).toBeVisible();
  });

  test("a YouCanBook.me cancellation only loses a lead before the visit, and booking again reopens it", async ({ page }) => {
    expect(YCBM_SECRET, "YCBM_WEBHOOK_SECRET in .env").not.toBe("");
    const stamp = Date.now();
    const person = { firstName: "Booking", lastName: `Test ${stamp} [TEST DATA]`, email: `ycbm-${stamp}@example.com`, phone: phoneFor(stamp), projectTypes: "Interior" };
    const name = `Booking Test ${stamp} [TEST DATA]`;
    const stageOf = () => page.getByLabel("Stage").locator("option:checked");

    const booked = await postBooking(page.request, { event: "booked", bookingId: `TEST-${stamp}-A`, startTime: "2026-10-29T10:00", ...person });
    expect(booked.status()).toBe(200);
    const { opportunityId } = (await booked.json()) as { opportunityId: string };
    await waitForNotice(page, (n) => n.title === `${name} booked an estimate visit`);

    // Before the visit: the lead is lost.
    expect((await postBooking(page.request, { event: "cancelled", bookingId: `TEST-${stamp}-A` })).status()).toBe(200);
    await waitForNotice(page, (n) => n.title === `${name} cancelled their estimate visit` && n.body === "The lead moved to Lost.");
    await page.goto(`/leads/${opportunityId}`);
    await expect(stageOf()).toHaveText("Lost");

    // Booking again reopens the same lead instead of starting a second one.
    const rebooked = await postBooking(page.request, { event: "booked", bookingId: `TEST-${stamp}-B`, startTime: "2026-10-30T11:00", ...person });
    expect(((await rebooked.json()) as { opportunityId: string }).opportunityId).toBe(opportunityId);
    await waitForNotice(page, (n) => n.title === `${name} booked again`);
    await page.reload();
    await expect(stageOf()).toHaveText("Estimate Booked");
    await expect(page.getByText("Booked again – reopened and moved back to Estimate Booked")).toBeVisible();

    // After the visit the lead's progress wins: it stays where it is.
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/leads/${opportunityId}`);
    await page.getByLabel("Stage").selectOption({ label: "Proposal Sent" });
    await saved;
    await page.reload();
    await expect(stageOf()).toHaveText("Proposal Sent");
    expect((await postBooking(page.request, { event: "cancelled", bookingId: `TEST-${stamp}-B` })).status()).toBe(200);
    await waitForNotice(page, (n) => n.title === `${name} cancelled their estimate visit` && !!n.body?.startsWith("The lead stays in Proposal Sent"));
    await page.reload();
    await expect(stageOf()).toHaveText("Proposal Sent");
    await expect(page.getByText("Booking cancelled in YouCanBook.me. The lead stays in Proposal Sent.")).toBeVisible();
  });
});

test.describe("as a painter", () => {
  test.use({ storageState: statePath("painter") });

  test("Couldn't import is only for people who manage leads", async ({ page }) => {
    await expectNoAccess(page, "/leads/not-imported");
  });
});

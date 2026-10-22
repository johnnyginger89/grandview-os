import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";
import type { CancelResult, IngestResult } from "./leads";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  ingested: [] as { lead: Record<string, unknown>; opts: Record<string, unknown> }[],
  ingestResult: null as unknown,
  cancelled: [] as string[],
  cancelResult: null as unknown,
  notices: [] as { ids: string[]; kind: string; title: string; body?: string | null; href?: string | null }[],
  asked: [] as { extra: unknown[]; except: string | null | undefined }[],
  audits: [] as { action: string; actorId: string | null; before?: unknown; after?: unknown }[],
  rows: {} as Record<string, unknown[] | ((c: FakeCall) => unknown[])>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./leads", () => ({
  ingestLead: async (lead: Record<string, unknown>, opts: Record<string, unknown>) => {
    h.ingested.push({ lead, opts });
    if (h.ingestResult instanceof Error) throw h.ingestResult;
    return h.ingestResult;
  },
  cancelBooking: async (ref: string) => (h.cancelled.push(ref), h.cancelResult),
}));
vi.mock("./notifications", () => ({
  notify: async (ids: string[], n: { kind: string; title: string; body?: string | null; href?: string | null }) => void h.notices.push({ ids, ...n }),
  notifyLater: (task: () => Promise<void>) => void task(),
  officeRecipients: async (extra: (string | null)[] = [], except?: string | null) => {
    h.asked.push({ extra, except });
    const office = [
      { id: "owner-1", role: "owner" },
      { id: "ops-1", role: "operations_manager" },
    ];
    return [...office, ...extra.filter((x): x is string => !!x).map((id) => ({ id, role: "estimator" }))].filter((u) => u.id !== except);
  },
}));
vi.mock("./audit", () => ({ audit: async (e: { action: string; actorId: string | null }) => void h.audits.push(e) }));

const inbound = await import("./inbound-events");

const EVENT = "00000000-0000-4000-8000-000000000001";
const OPP = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-22T18:00:00Z");
const flush = () => new Promise((r) => setTimeout(r, 0));

const event = (o: Record<string, unknown> = {}) => ({ id: EVENT, source: "website_form", externalRef: null, payload: {}, status: "received", error: null, opportunityId: null, receivedAt: NOW, processedAt: null, ...o });
const ingested = (o: Partial<IngestResult> = {}): IngestResult => ({
  opportunityId: OPP,
  customerId: "cust-1",
  created: true,
  matchedExistingCustomer: false,
  outcome: "created",
  customerName: "Ann Lee [TEST DATA]",
  estimatorId: null,
  stageName: "New Lead – To Contact",
  visitAt: null,
  ...o,
});
const sets = () => h.fake.find("update", "inbound_events").map((u) => u.args.set?.[0] as Record<string, unknown>);

beforeEach(() => {
  h.fake.reset();
  h.ingested = [];
  h.ingestResult = ingested();
  h.cancelled = [];
  h.cancelResult = null;
  h.notices = [];
  h.asked = [];
  h.audits = [];
  h.rows = {};
  h.fake.otherwise((call) => {
    const r = h.rows[`${call.op}:${call.table}`];
    return typeof r === "function" ? r(call) : (r ?? []);
  });
});

describe("website form submissions", () => {
  it("are stored, imported and the office is told about the new lead", async () => {
    const payload = { name: "Ann Lee [TEST DATA]", email: "ann@example.com", phone: "604-555-0100", service: "Interior", city: "Surrey", message: "Two bedrooms and a hallway" };
    h.fake.queue({ "insert:inbound_events": [[event({ payload })]] });
    const r = await inbound.receiveWebForm(payload);
    await flush();

    expect(h.fake.find("insert", "inbound_events")[0].args.values[0]).toMatchObject({ source: "website_form", payload });
    expect(h.ingested[0].opts).toEqual({ stageKey: "new_lead", channel: "website_form", externalSource: "website_form", matchOpenLead: true });
    expect(h.ingested[0].lead).toMatchObject({ firstName: "Ann", email: "ann@example.com", projectTypes: ["Interior"], description: "Two bedrooms and a hallway" });
    expect(sets()).toEqual([expect.objectContaining({ status: "processed", error: null, opportunityId: OPP })]);
    expect(r).toEqual({ ok: true, opportunityId: OPP, customerId: "cust-1", created: true, matchedExistingCustomer: false });
    expect(h.notices).toEqual([
      { ids: ["owner-1", "ops-1"], kind: "lead.web", title: "New web lead: Ann Lee [TEST DATA]", body: "Interior · Surrey – Two bedrooms and a hallway", href: `/leads/${OPP}`, entityType: "opportunity", entityId: OPP },
    ]);
  });

  it("keep a bad email and over-long text instead of rejecting the lead", async () => {
    const payload = { name: "Ann Lee", email: "ann@example", message: "y".repeat(2500) };
    h.fake.queue({ "insert:inbound_events": [[event({ payload })]] });
    expect((await inbound.receiveWebForm(payload)).ok).toBe(true);
    const lead = h.ingested[0].lead;
    expect(lead.email).toBeNull();
    expect(lead.description).toHaveLength(2000);
    expect(lead.notes).toContain("Email as received: ann@example");
    expect(lead.notes).toContain("shortened: message");
  });

  it("added to an open lead tell the office and the lead's estimator", async () => {
    h.ingestResult = ingested({ created: false, matchedExistingCustomer: true, outcome: "merged", estimatorId: "est-1", stageName: "Contacted" });
    const payload = { name: "Ann Lee [TEST DATA]", phone: "604-555-0100", message: "Can you also do the fence?" };
    h.fake.queue({ "insert:inbound_events": [[event({ payload })]] });
    await inbound.receiveWebForm(payload);
    await flush();
    expect(h.asked).toEqual([{ extra: ["est-1"], except: null }]);
    expect(h.notices[0]).toMatchObject({ ids: ["owner-1", "ops-1", "est-1"], title: "Ann Lee [TEST DATA] sent the website form again", body: "Added to their open lead (Contacted) – Can you also do the fence?" });
  });

  it("with nothing to say who sent them are kept as failed, with a reason, and the office is told", async () => {
    const payload = { message: "Please call me about my deck", city: "Surrey" };
    h.fake.queue({ "insert:inbound_events": [[event({ payload })]] });
    const r = await inbound.receiveWebForm(payload);
    await flush();

    expect(h.ingested).toEqual([]);
    const reason = "It has no name, email or phone number, so there's no way to tell who it's from.";
    expect(r).toEqual({ ok: false, error: reason, unreadable: false });
    expect(sets()).toEqual([expect.objectContaining({ status: "failed", error: reason })]);
    expect(h.notices).toEqual([
      { ids: ["owner-1", "ops-1"], kind: "lead.import_failed", title: "A website lead couldn't be imported", body: reason, href: "/leads/not-imported", entityType: "inbound_event", entityId: EVENT },
    ]);
  });

  it("name the email they typed when it's the only clue", async () => {
    const payload = { email: "ann at example dot com" };
    h.fake.queue({ "insert:inbound_events": [[event({ payload })]] });
    const r = await inbound.receiveWebForm(payload);
    await flush();
    expect(r.ok).toBe(false);
    expect(h.notices[0].body).toBe('ann at example dot com: It has no name or phone number, and the email address "ann at example dot com" isn\'t valid, so there\'s no way to tell who it\'s from.');
  });

  it("that fail to save are kept as failed with the error, and the office is told", async () => {
    h.ingestResult = new Error("connection reset");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    h.fake.queue({ "insert:inbound_events": [[event({ payload: { name: "Ann Lee" } })]] });
    const r = await inbound.receiveWebForm({ name: "Ann Lee" });
    await flush();
    errors.mockRestore();
    expect(r).toEqual({ ok: false, error: "Something went wrong while saving it (connection reset). Try again in a few minutes.", unreadable: false });
    expect(h.notices[0]).toMatchObject({ title: "A website lead couldn't be imported", body: "Ann Lee: Something went wrong while saving it (connection reset). Try again in a few minutes." });
  });

  it("that can't be read are kept as failed", async () => {
    h.fake.queue({ "insert:inbound_events": [[event({ payload: { unparseable: "hello" } })]] });
    const r = await inbound.receiveWebForm({ unparseable: "hello" });
    expect(r).toEqual({ ok: false, error: "What was sent couldn't be read, so there are no details to import.", unreadable: true });
  });
});

describe("YouCanBook.me bookings", () => {
  const booked = { event: "booked", bookingId: "YC-1", firstName: "Ann", lastName: "Lee", email: "ann@example.com", startTime: "2026-10-29T09:30", projectTypes: "Interior" };

  it("are imported into Estimate Booked and the office and estimator are told", async () => {
    h.ingestResult = ingested({ outcome: "promoted", created: false, matchedExistingCustomer: true, estimatorId: "est-1", stageName: "Estimate Booked", visitAt: new Date("2026-10-29T16:30:00Z") });
    h.fake.queue({ "insert:inbound_events": [[event({ source: "youcanbookme", externalRef: "YC-1:booked:", payload: booked })]] });
    const r = await inbound.receiveBooking(JSON.stringify(booked));
    await flush();

    expect(h.fake.find("insert", "inbound_events")[0].args.values[0]).toMatchObject({ source: "youcanbookme", externalRef: "YC-1:booked:" });
    expect(h.ingested[0].opts).toEqual({ stageKey: "estimate_booked", channel: "youcanbookme", externalSource: "youcanbookme", externalRef: "YC-1" });
    expect(r.ok).toBe(true);
    expect(h.notices).toEqual([
      expect.objectContaining({ ids: ["owner-1", "ops-1", "est-1"], kind: "lead.booking", title: "Ann Lee [TEST DATA] booked an estimate visit", body: "Visit Oct 29, 2026, 9:30 a.m. · Their lead moved to Estimate Booked · Interior" }),
    ]);
  });

  it("say when a booking is changed or made again after a cancellation", async () => {
    h.ingestResult = ingested({ outcome: "reopened", stageName: "Estimate Booked", visitAt: new Date("2026-10-30T17:00:00Z") });
    h.fake.queue({ "insert:inbound_events": [[event({ source: "youcanbookme", payload: booked })]] });
    await inbound.receiveBooking(JSON.stringify(booked));
    await flush();
    expect(h.notices[0]).toMatchObject({ title: "Ann Lee [TEST DATA] booked again", body: "Visit Oct 30, 2026, 10:00 a.m. · Their cancelled lead is open again in Estimate Booked · Interior" });

    h.notices = [];
    h.ingestResult = ingested({ outcome: "booking_updated", visitAt: new Date("2026-10-30T17:00:00Z") });
    h.fake.queue({ "insert:inbound_events": [[event({ source: "youcanbookme", payload: booked })]] });
    await inbound.receiveBooking(JSON.stringify(booked));
    await flush();
    expect(h.notices[0]).toMatchObject({ title: "Ann Lee [TEST DATA] changed their estimate visit", body: "Visit Oct 30, 2026, 10:00 a.m. · Interior" });
  });

  it("sent again are ignored", async () => {
    h.fake.queue({ "select:inbound_events": [[{ id: "earlier", opportunityId: OPP, status: "processed" }]] });
    expect(await inbound.receiveBooking(JSON.stringify(booked))).toEqual({ ok: true, duplicate: true, opportunityId: OPP });
    expect(h.fake.find("insert", "inbound_events")).toEqual([]);
    expect(h.ingested).toEqual([]);
  });

  it("set aside earlier failed deliveries of the same booking once one goes through", async () => {
    h.fake.queue({ "insert:inbound_events": [[event({ source: "youcanbookme", externalRef: "YC-1:booked:", payload: booked })]] });
    await inbound.receiveBooking(JSON.stringify(booked));
    const [, superseded] = h.fake.find("update", "inbound_events");
    expect(superseded.args.set[0]).toMatchObject({ status: "duplicate", opportunityId: OPP });
  });

  it("that can't be read are kept as failed", async () => {
    h.fake.queue({ "insert:inbound_events": [[event({ source: "youcanbookme", payload: { unparseable: "not json at all" } })]] });
    const r = await inbound.receiveBooking("not json at all");
    expect(h.fake.find("insert", "inbound_events")[0].args.values[0]).toMatchObject({ externalRef: null, payload: { unparseable: "not json at all" } });
    expect(r).toMatchObject({ ok: false, unreadable: true });
    await flush();
    expect(h.notices[0].title).toBe("A YouCanBook.me booking couldn't be imported");
  });

  describe("cancellations", () => {
    const cancel = { event: "cancelled", bookingId: "YC-1", firstName: "Ann", lastName: "Lee" };
    const run = async (c: Partial<CancelResult>) => {
      h.cancelResult = { outcome: "lost", opportunityId: OPP, customerName: "Ann Lee [TEST DATA]", estimatorId: "est-1", stageName: "Lost", ...c };
      h.fake.queue({ "insert:inbound_events": [[event({ source: "youcanbookme", payload: cancel })]] });
      const r = await inbound.receiveBooking(JSON.stringify(cancel));
      await flush();
      return r;
    };

    it("before the visit: the lead is lost and the office and estimator are told", async () => {
      expect(await run({})).toEqual({ ok: true, opportunityId: OPP, cancelled: true });
      expect(h.cancelled).toEqual(["YC-1"]);
      expect(h.ingested).toEqual([]);
      expect(h.notices).toEqual([expect.objectContaining({ ids: ["owner-1", "ops-1", "est-1"], kind: "lead.booking_cancelled", title: "Ann Lee [TEST DATA] cancelled their estimate visit", body: "The lead moved to Lost." })]);
    });

    it("later on: the lead stays where it is", async () => {
      await run({ outcome: "noted", stageName: "Proposal Sent" });
      expect(h.notices[0].body).toBe("The lead stays in Proposal Sent. The cancellation is on its timeline.");
    });

    it("for a booking that isn't here: nothing changes, but the office hears about it", async () => {
      expect(await run({ outcome: "not_found", opportunityId: null, customerName: null, estimatorId: null, stageName: null })).toEqual({ ok: true, opportunityId: null, cancelled: false });
      expect(h.notices[0]).toMatchObject({ ids: ["owner-1", "ops-1"], title: "A YouCanBook.me booking was cancelled", body: "Ann Lee. No lead here matches it, so nothing changed." });
    });

    it("without a booking reference are kept as failed", async () => {
      h.fake.queue({ "insert:inbound_events": [[event({ source: "youcanbookme", payload: { event: "cancelled", firstName: "Ann" } })]] });
      const r = await inbound.receiveBooking(JSON.stringify({ event: "cancelled", firstName: "Ann" }));
      expect(r).toMatchObject({ ok: false, error: "It's a cancellation with no booking reference, so there's no way to tell which booking it was." });
      expect(h.cancelled).toEqual([]);
    });
  });
});

describe("Couldn't import: Retry", () => {
  const ACTOR = { id: "owner-1" };
  const failed = event({ status: "failed", error: "Something went wrong while saving it (timeout). Try again in a few minutes.", payload: { name: "Ann Lee", phone: "604-555-0100" } });

  it("runs the stored submission again, links the lead and tells everyone else", async () => {
    h.fake.queue({ "select:inbound_events": [[failed], []], "update:inbound_events": [[{ ...failed, status: "received" }]] });
    expect(await inbound.retryImport(EVENT, ACTOR)).toEqual({ ok: true, opportunityId: OPP, message: "Imported." });
    await flush();

    const [claim, done] = sets();
    expect(claim).toMatchObject({ status: "received" });
    expect(done).toMatchObject({ status: "processed", error: null, opportunityId: OPP });
    expect(h.ingested).toHaveLength(1);
    expect(h.audits).toEqual([expect.objectContaining({ action: "inbound.retry", actorId: "owner-1", before: { status: "failed", error: failed.error }, after: { status: "processed", opportunityId: OPP } })]);
    expect(h.asked[0].except).toBe("owner-1");
    expect(h.notices[0].ids).toEqual(["ops-1"]);
  });

  it("keeps it on the list with the new reason when it fails again, without another notice", async () => {
    h.fake.queue({ "select:inbound_events": [[event({ status: "failed", error: "old", payload: { message: "hi" } })], []], "update:inbound_events": [[event({ status: "received", payload: { message: "hi" } })]] });
    const r = await inbound.retryImport(EVENT, ACTOR);
    await flush();
    expect(r).toEqual({ ok: false, error: "It has no name, email or phone number, so there's no way to tell who it's from." });
    expect(sets()[1]).toMatchObject({ status: "failed" });
    expect(h.notices).toEqual([]);
    expect(h.audits[0]).toMatchObject({ action: "inbound.retry", after: { status: "failed" } });
  });

  it("only lets one person retry at a time, and is harmless once it's been dealt with", async () => {
    h.fake.queue({ "select:inbound_events": [[event({ status: "received", receivedAt: new Date() })]] });
    await expect(inbound.retryImport(EVENT, ACTOR)).rejects.toThrow("It's being imported right now.");
    h.fake.queue({ "select:inbound_events": [[event({ status: "processed", opportunityId: OPP })]] });
    expect(await inbound.retryImport(EVENT, ACTOR)).toEqual({ ok: true, opportunityId: OPP, message: "This one has already been dealt with." });
    expect(h.ingested).toEqual([]);
    h.fake.queue({ "select:inbound_events": [[]] });
    await expect(inbound.retryImport(EVENT, ACTOR)).rejects.toThrow("wasn't found");
  });

  it("sets aside a booking event when a later one for the same booking was already imported", async () => {
    const old = event({ source: "youcanbookme", status: "failed", externalRef: "YC-1:booked:", payload: { bookingId: "YC-1", firstName: "Ann", startTime: "2026-10-29T09:30" } });
    h.fake.queue({ "select:inbound_events": [[old], [{ id: "newer", opportunityId: OPP }]], "update:inbound_events": [[{ ...old, status: "received" }]] });
    const r = await inbound.retryImport(EVENT, ACTOR);
    expect(r).toEqual({ ok: true, opportunityId: OPP, message: "A later update for this booking was already imported, so this older one was set aside." });
    expect(h.ingested).toEqual([]);
    expect(sets()[1]).toMatchObject({ status: "duplicate", opportunityId: OPP });
  });
});

describe("Couldn't import: Dismiss", () => {
  it("takes it off the list, says who dismissed it, and is audited", async () => {
    h.fake.queue({ "select:inbound_events": [[event({ status: "failed", error: "It has no name, email or phone number." })]], "update:inbound_events": [[{ id: EVENT }]] });
    await inbound.dismissImport(EVENT, { id: "owner-1", name: "Owner (Dev)" });
    expect(sets()[0]).toMatchObject({ status: "processed", error: "Dismissed by Owner (Dev). It has no name, email or phone number." });
    expect(h.audits).toEqual([expect.objectContaining({ action: "inbound.dismiss", actorId: "owner-1" })]);
  });

  it("does nothing when someone else already dealt with it", async () => {
    h.fake.queue({ "select:inbound_events": [[event({ status: "processed" })]], "update:inbound_events": [[]] });
    await inbound.dismissImport(EVENT, { id: "owner-1", name: "Owner (Dev)" });
    expect(h.audits).toEqual([]);
  });
});

describe("Couldn't import: the list", () => {
  it("shows when, where from, who, the message and why", async () => {
    h.rows["select:inbound_events"] = [
      event({ status: "failed", error: "Reason one", payload: { name: "Ann Lee", email: "ann@example", phone: "604-555-0100", message: "Two rooms" } }),
      event({ id: "e2", source: "youcanbookme", status: "failed", error: "Reason two", payload: { event: "cancelled", bookingId: "YC-1", company: "Strata Corp", startTime: "Thursday 9:30" } }),
      event({ id: "e3", source: "youcanbookme", status: "failed", error: "Unreadable", payload: { unparseable: "garbage" } }),
      event({ id: "e4", status: "received", payload: { name: "Bo", startTime: "2026-10-29T09:30" } }),
    ];
    const [one, two, three, four] = await inbound.listNotImported(NOW);
    expect(four.visit).toBe("Oct 29, 2026, 9:30 a.m.");
    expect(one).toMatchObject({ sourceLabel: "Website form", name: "Ann Lee", email: "ann@example", phone: "604-555-0100", message: "Two rooms", reason: "Reason one", cancellation: false, receivedAt: NOW });
    expect(two).toMatchObject({ sourceLabel: "YouCanBook.me", name: "Strata Corp", visit: "Thursday 9:30", cancellation: true });
    expect(three).toMatchObject({ name: null, message: "garbage", reason: "Unreadable" });
    expect(four.reason).toMatch(/didn't finish importing/);
  });

  it("explains failures saved before imports were made forgiving, and old bookings that couldn't be read", async () => {
    const zodError = JSON.stringify([{ origin: "string", code: "invalid_format", format: "email", path: ["email"], message: "Invalid email address" }]);
    h.rows["select:inbound_events"] = [
      event({ status: "failed", error: zodError, payload: { name: "Ann Lee", email: "ann@example" } }),
      event({ id: "e2", source: "youcanbookme", status: "received", payload: { unparseable: "garbage" } }),
    ];
    const [legacy, stuck] = await inbound.listNotImported(NOW);
    expect(legacy.reason).toBe("A field was turned away (email: Invalid email address). Imports are more forgiving now, so Retry should bring it in.");
    expect(stuck.reason).toBe("What was sent couldn't be read, so there are no details to import.");
  });

  it("counts what's waiting", async () => {
    h.rows["select:inbound_events"] = [{ n: 3 }];
    expect(await inbound.countNotImported(NOW)).toBe(3);
  });
});

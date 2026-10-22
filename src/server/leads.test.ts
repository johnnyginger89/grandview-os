import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PIPELINE_STAGES } from "@/db/seed-data";
import { cleanInboundLead } from "@/lib/pipeline/lead-input";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as { action: string; entityId?: string | null; before?: unknown; after?: unknown }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: { action: string }) => void h.audits.push(e) }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ status: "logged", provider: "test" }) }));
vi.mock("./settings", () => ({ getCompany: async () => ({ bookingUrl: null, phone: null }) }));

const { cancelBooking, ingestLead, leadInputSchema } = await import("./leads");

// Before Nov 1, so Vancouver times don't depend on the time zone data version.
const NOW = new Date("2026-10-22T18:00:00Z");
const CUST = "00000000-0000-4000-8000-000000000010";
const OPP = "00000000-0000-4000-8000-000000000020";
const PROP = "00000000-0000-4000-8000-000000000030";

const stage = (key: string) => {
  const s = PIPELINE_STAGES.find((x) => x.key === key)!;
  return { id: `stage-${key}`, key: s.key, name: s.name, kind: s.kind, position: 1, color: s.color, staleAfterDays: null };
};
const customer = (o: Record<string, unknown> = {}) => ({ id: CUST, displayName: "Ann Lee [TEST DATA]", email: "ann@example.com", phone: null, archivedAt: null, ...o });
const primary = (o: Record<string, unknown> = {}) => ({ id: "contact-1", email: "ann@example.com", phone: null, phone2: null, isPrimary: true, ...o });
const opp = (o: Record<string, unknown> = {}) => ({
  id: OPP,
  title: "Ann Lee",
  customerId: CUST,
  propertyId: null,
  stageId: "stage-contacted",
  source: null,
  channel: "website_form",
  projectTypes: [] as string[],
  description: null,
  timeline: null,
  estimatorId: "est-1",
  estimateVisitAt: null,
  visitBookedAt: null,
  visitCompletedAt: null,
  bookingRef: null,
  bookingManageUrl: null,
  lastContactedAt: null,
  nextFollowUpAt: new Date("2026-10-25T16:00:00Z"),
  lostReason: null,
  wonAt: null,
  closedAt: null,
  externalSource: null,
  externalRef: null,
  ...o,
});

const booking = (o: Record<string, unknown> = {}) =>
  cleanInboundLead({ firstName: "Ann", lastName: "Lee", email: "ann@example.com", phone: "604-555-0100", street: "1 Main St", city: "Surrey", projectTypes: ["Interior"], leadSource: "Google Search", description: "Also the hallway", visitAt: "2026-10-29T09:30", bookingRef: "YC-2", ...o });
const YCBM = { stageKey: "estimate_booked", channel: "youcanbookme", externalSource: "youcanbookme", externalRef: "YC-2" } as const;
const FORM = { stageKey: "new_lead", channel: "website_form", externalSource: "website_form", matchOpenLead: true } as const;

const oppSets = () => h.fake.find("update", "opportunities").map((u) => u.args.set?.[0] as Record<string, unknown>);
const activityRows = () => h.fake.find("insert", "activities").flatMap((c) => c.args.values?.[0] as Record<string, unknown>[]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.fake.reset();
  h.audits = [];
});
afterEach(() => vi.useRealTimers());

describe("lenient inbound leads always pass the lead schema", () => {
  it("whatever arrives", () => {
    const junk = [
      { email: "not an email", description: "z".repeat(9000), projectTypes: Array.from({ length: 50 }, () => "w".repeat(300)) },
      { firstName: "   ", email: "   ", visitAt: "whenever", bookingManageUrl: "u".repeat(3000) },
      { company: "Strata", notes: "n".repeat(2500), email: "A@B.CO" },
    ];
    for (const j of junk) expect(() => leadInputSchema.parse(cleanInboundLead(j))).not.toThrow();
  });
});

describe("a booking from someone with an early lead", () => {
  const queue = (early: Record<string, unknown>, stageKey: string, stageKind: string) =>
    h.fake.queue({
      "select:pipeline_stages": [[stage("estimate_booked")]],
      "select:opportunities": [[], [{ opp: early, stageKey, stageKind }]],
      "select:customers": [[customer()]],
      "select:contacts": [[primary()]],
      "select:properties": [[]],
      "insert:properties": [[{ id: PROP, street: "1 Main St", unit: null, city: "Surrey", province: "BC", postalCode: null }]],
    });

  it("moves that lead to Estimate Booked and adds the new details without overwriting", async () => {
    queue(opp({ description: "Two bedrooms" }), "contacted", "open");
    const r = await ingestLead(booking(), YCBM);

    expect(r).toMatchObject({ opportunityId: OPP, outcome: "promoted", created: false, matchedExistingCustomer: true, customerName: "Ann Lee [TEST DATA]", estimatorId: "est-1", stageName: "Estimate Booked" });
    expect(r.visitAt?.toISOString()).toBe("2026-10-29T16:30:00.000Z");
    expect(h.fake.find("insert", "opportunities")).toEqual([]);
    expect(oppSets()).toEqual([
      expect.objectContaining({
        stageId: "stage-estimate_booked",
        estimateVisitAt: new Date("2026-10-29T16:30:00Z"),
        bookingRef: "YC-2",
        externalSource: "youcanbookme",
        externalRef: "YC-2",
        nextFollowUpAt: null,
        source: "Google Search",
        projectTypes: ["Interior"],
        propertyId: PROP,
        description: "Two bedrooms\n\nFrom YouCanBook.me, Oct 22, 2026:\nAlso the hallway",
      }),
    ]);
    // The matched customer's phone was empty, so it's filled in.
    expect(h.fake.find("update", "customers")[0].args.set[0]).toMatchObject({ phone: "604-555-0100" });
    expect(h.fake.find("update", "contacts")[0].args.set[0]).toMatchObject({ phone: "604-555-0100" });
    expect(activityRows()).toEqual([
      expect.objectContaining({ type: "booking", body: "Estimate visit booked – moved to Estimate Booked", createdAt: new Date(NOW.getTime() + 1) }),
      expect.objectContaining({ type: "note", body: "New details from YouCanBook.me:\nAlso the hallway\n\nPhone number added: 604-555-0100", createdAt: NOW }),
    ]);
    expect(h.audits.map((a) => a.action)).toEqual(["customer.update", "lead.merge", "lead.stage"]);
  });

  it("lists details that differ instead of replacing them", async () => {
    queue(opp({ source: "Referral", projectTypes: ["Exterior"], propertyId: "other-property", description: "Also the hallway" }), "new_lead", "open");
    await ingestLead(booking(), YCBM);
    const set = oppSets()[0];
    expect(set).not.toHaveProperty("source");
    expect(set).not.toHaveProperty("projectTypes");
    expect(set).not.toHaveProperty("propertyId");
    expect(set).not.toHaveProperty("description");
    expect(activityRows()[1].body).toBe(
      ["New details from YouCanBook.me:", "Heard about us via: Google Search (on file: Referral)", "Also asked about: Interior", "Address given: 1 Main St, Surrey, BC", "Phone number added: 604-555-0100"].join("\n"),
    );
  });

  it("reopens a lead that a cancelled booking had lost, instead of starting a duplicate", async () => {
    queue(opp({ stageId: "stage-lost", lostReason: "Booking cancelled", closedAt: new Date("2026-10-15T18:00:00Z") }), "lost", "lost");
    const r = await ingestLead(booking(), YCBM);
    expect(r.outcome).toBe("reopened");
    expect(h.fake.find("insert", "opportunities")).toEqual([]);
    expect(oppSets()[0]).toMatchObject({ stageId: "stage-estimate_booked", lostReason: null, closedAt: null, externalRef: "YC-2" });
    expect(activityRows()[0].body).toBe("Booked again – reopened and moved back to Estimate Booked");
    expect(h.audits.find((a) => a.action === "lead.stage")).toMatchObject({ before: { stage: "lost" }, after: { stage: "estimate_booked" } });
  });
});

describe("the same booking again", () => {
  const queue = (current: string, o: Record<string, unknown> = {}) =>
    h.fake.queue({
      "select:pipeline_stages": [[stage("estimate_booked")], [stage(current)]],
      "select:opportunities": [[opp({ stageId: `stage-${current}`, externalSource: "youcanbookme", externalRef: "YC-2", estimateVisitAt: new Date("2026-10-29T16:30:00Z"), ...o })]],
      "select:customers": [[customer({ phone: "604-555-0100" })]],
      "select:contacts": [[primary({ phone: "604-555-0100" })]],
    });

  it("updates the visit time and leaves a lead that's further along where it is", async () => {
    queue("proposal_sent");
    const r = await ingestLead(booking({ street: null, visitAt: "2026-10-30T10:00" }), YCBM);
    expect(r).toMatchObject({ outcome: "booking_updated", stageName: "Proposal Sent" });
    const set = oppSets()[0];
    expect(set).toMatchObject({ estimateVisitAt: new Date("2026-10-30T17:00:00Z") });
    expect(set).not.toHaveProperty("stageId");
    expect(activityRows()[0].body).toBe("Booking updated – visit Oct 30, 2026, 10:00 a.m.");
  });

  it("reopens it when a cancellation had lost it", async () => {
    queue("lost", { lostReason: "Booking cancelled" });
    const r = await ingestLead(booking({ street: null }), YCBM);
    expect(r.outcome).toBe("reopened");
    expect(oppSets()[0]).toMatchObject({ stageId: "stage-estimate_booked", lostReason: null, closedAt: null });
  });

  it("doesn't reopen a lead someone marked lost for another reason", async () => {
    queue("lost", { lostReason: "Price" });
    const r = await ingestLead(booking({ street: null }), YCBM);
    expect(r).toMatchObject({ outcome: "booking_updated", stageName: "Lost" });
    expect(oppSets()[0]).not.toHaveProperty("stageId");
  });
});

describe("a website form from someone who already has an open lead", () => {
  it("is added to that lead", async () => {
    h.fake.queue({
      "select:pipeline_stages": [[stage("new_lead")]],
      "select:customers": [[customer({ phone: "604-555-0100" })]],
      "select:contacts": [[primary({ phone: "604-555-0100" })]],
      "select:opportunities": [[{ opp: opp({ source: "Referral", projectTypes: ["Interior"], description: "Two bedrooms" }), stageName: "Contacted" }]],
    });
    const r = await ingestLead(cleanInboundLead({ firstName: "Ann", email: "ann@example.com", phone: "778-555-0199", leadSource: "Google Search", projectTypes: ["Interior", "Exterior"], description: "And the fence", notes: "Prefers texts" }), FORM);

    expect(r).toMatchObject({ opportunityId: OPP, outcome: "merged", created: false, stageName: "Contacted", estimatorId: "est-1" });
    expect(h.fake.find("insert", "opportunities")).toEqual([]);
    expect(h.fake.find("update", "customers")).toEqual([]);
    expect(oppSets()[0]).toMatchObject({ description: "Two bedrooms\n\nFrom the website form, Oct 22, 2026:\nAnd the fence" });
    expect(oppSets()[0]).not.toHaveProperty("source");
    expect(activityRows()).toEqual([
      expect.objectContaining({ type: "system", body: "New inquiry from the website form – added to this lead" }),
      expect.objectContaining({
        type: "note",
        body: [
          "New details from the website form:",
          "And the fence",
          "",
          "Prefers texts",
          "Heard about us via: Google Search (on file: Referral)",
          "Also asked about: Exterior",
          "New phone number given: 778-555-0199 (on file: 604-555-0100)",
        ].join("\n"),
      }),
    ]);
  });

  it("gets a new lead when they have no open one, with any new contact details noted", async () => {
    h.fake.queue({
      "select:pipeline_stages": [[stage("new_lead")]],
      "select:customers": [[customer({ phone: "604-555-0100" })]],
      "select:contacts": [[primary({ phone: "604-555-0100" })]],
      "select:opportunities": [[]],
      "insert:opportunities": [[opp({ id: "new-opp", estimatorId: null })]],
    });
    const r = await ingestLead(cleanInboundLead({ firstName: "Ann", email: "ann@example.com", phone: "778-555-0199" }), FORM);
    expect(r).toMatchObject({ opportunityId: "new-opp", outcome: "created", created: true, matchedExistingCustomer: true });
    expect(activityRows()).toEqual([
      expect.objectContaining({ type: "system", body: "New lead from website form" }),
      expect.objectContaining({ type: "note", body: "New phone number given: 778-555-0199 (on file: 604-555-0100)" }),
    ]);
    expect(h.audits.map((a) => a.action)).toEqual(["lead.create"]);
  });
});

describe("a lead typed in by hand", () => {
  it("still starts a new lead for an existing customer", async () => {
    h.fake.queue({
      "select:pipeline_stages": [[stage("new_lead")]],
      "select:customers": [[customer()]],
      "select:contacts": [[primary()]],
      "insert:opportunities": [[opp({ id: "new-opp" })]],
    });
    const r = await ingestLead({ firstName: "Ann", email: "ann@example.com", notes: "Called in" }, { stageKey: "new_lead", channel: "phone", actorId: "owner-1" });
    expect(r.outcome).toBe("created");
    expect(h.fake.find("select", "opportunities")).toEqual([]);
    expect(activityRows()).toEqual([expect.objectContaining({ body: "New lead from phone", createdBy: "owner-1" }), expect.objectContaining({ type: "note", body: "Called in" })]);
  });
});

describe("cancelBooking", () => {
  const queue = (current: string) =>
    h.fake.queue({
      "select:opportunities": [[opp({ stageId: `stage-${current}`, externalSource: "youcanbookme", externalRef: "YC-2" })]],
      "select:pipeline_stages": [[stage(current)], [stage("lost")]],
      "select:customers": [[customer()]],
    });

  it("loses a lead that's still waiting for its estimate visit", async () => {
    queue("estimate_booked");
    expect(await cancelBooking("YC-2")).toEqual({ outcome: "lost", opportunityId: OPP, customerName: "Ann Lee [TEST DATA]", estimatorId: "est-1", stageName: "Lost" });
    expect(oppSets()[0]).toMatchObject({ stageId: "stage-lost", lostReason: "Booking cancelled", closedAt: NOW });
    expect(activityRows()[0]).toMatchObject({ type: "stage_change", body: "Moved from Estimate Booked to Lost (Booking cancelled)" });
    expect(h.audits).toEqual([expect.objectContaining({ action: "lead.stage", after: { stage: "lost" } })]);
  });

  it("only notes the cancellation once the lead is past the visit", async () => {
    for (const key of ["estimate_completed", "proposal_sent", "won"]) {
      h.fake.reset();
      queue(key);
      const r = await cancelBooking("YC-2");
      expect(r.outcome, key).toBe("noted");
      expect(oppSets(), key).toEqual([]);
      expect(activityRows()[0]).toMatchObject({ type: "booking", body: `Booking cancelled in YouCanBook.me. The lead stays in ${stage(key).name}.` });
    }
  });

  it("finds nothing for a booking that isn't here", async () => {
    expect(await cancelBooking("NOPE")).toEqual({ outcome: "not_found", opportunityId: null, customerName: null, estimatorId: null, stageName: null });
    expect(h.fake.calls.filter((c) => c.op !== "select")).toEqual([]);
  });
});

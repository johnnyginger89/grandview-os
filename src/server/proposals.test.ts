import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";
import type { FakeCall, FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  /** db.query.<table>.findFirst / findMany answers. */
  found: {} as Record<string, unknown>,
  many: {} as Record<string, unknown[]>,
  transactions: 0,
  notified: [] as unknown[][],
  sold: [] as Record<string, unknown>[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  const db = h.fake.db;
  db.query = new Proxy({}, { get: (_t, table: string) => ({ findFirst: async () => h.found[table], findMany: async () => h.many[table] ?? [] }) });
  const run = db.transaction;
  db.transaction = (fn: (tx: unknown) => unknown) => {
    h.transactions++;
    return run(fn);
  };
  return { db };
});
vi.mock("./settings", async () => {
  const { DEFAULT_COMPANY } = await import("@/db/seed-data");
  const { DEFAULT_PROPOSAL_TEMPLATE } = await import("@/db/seed-proposal-template");
  return { getCompany: async () => DEFAULT_COMPANY, getProposalTemplate: async () => DEFAULT_PROPOSAL_TEMPLATE, getPricing: async () => ({ estimateValidDays: "30" }) };
});
vi.mock("./rates", () => ({ getRateSnapshot: async () => null }));
vi.mock("./media", () => ({ currentDocuments: async () => [], visibleDocuments: (d: unknown[]) => d }));
vi.mock("./notifications", () => ({ notifyLater: (fn: () => unknown) => void fn(), notifyProposalEvent: async (...a: unknown[]) => void h.notified.push(a) }));
vi.mock("./project-status", () => ({
  createSoldProject: async (values: Record<string, unknown>) => {
    h.sold.push(values);
    return { id: "00000000-0000-4000-8000-000000000077" };
  },
}));
vi.mock("./work-orders", () => ({ createWorkOrderForSale: async () => undefined }));
vi.mock("./leads", () => ({ moveStage: async () => undefined, stageByKey: async () => ({ id: "won" }) }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ status: "logged" }) }));

const { acceptancePreview, acceptProposal, acceptProposalForCustomer, declineProposal, proposalTotals, sendProposal, withdrawProposal } = await import("./proposals");
const { EstimateLockedError } = await import("./estimates");

const dialect = new PgDialect({ casing: "snake_case" });
const where = (c: FakeCall) => dialect.sqlToQuery(c.args.where[0] as SQL);
const setOf = (c: FakeCall) => c.args.set[0] as Record<string, unknown>;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EST = uuid(1);
const PROPOSAL = uuid(2);
const ROOM = uuid(3);
const WALLS = uuid(4);
const CEILING = uuid(5);
const CUSTOMER = uuid(6);
const TOKEN = "A".repeat(20) + "b".repeat(12);
const NOW = new Date("2026-10-21T18:00:00.000Z");
const V0 = new Date("2026-10-20T17:00:00.000Z");
const OWNER = { id: "owner-1", name: "Owner (Dev)" };
const STALE = "This estimate was changed on another device or tab. Reload to see the latest.";

function snap(name: string): RateSnapshot {
  return {
    rateId: uuid(500), rateVersion: 1, name, unit: "sqft", basis: "units_per_hour", productionRate: "150", additionalCoatFactor: "0.85", defaultCoats: 2,
    laborCostPerHour: "45", billingRatePerHour: "75", material: null, materialWastePct: "0.1", otherCostPerUnit: "0", category: "Interior", customerLabel: null, proposalGroup: null,
  };
}
const line = (id: string, name: string, price: string, extra: Partial<EstimateDoc["lines"][number]> = {}): EstimateDoc["lines"][number] => ({
  id, areaId: ROOM, description: name, customerDescription: null, customerDetail: null, rateSnapshot: snap(name), quantity: "300", quantitySource: "manual",
  coats: 2, prepFactor: "1", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null, overrideHours: null, overridePrice: price,
  isOptional: false, optionSelected: false, ...extra,
});
const SETTINGS = { pricingMethod: "target_margin" as const, laborCostPerHour: "45", billingRatePerHour: "75", targetMargin: "0.4", materialMarkupPct: "0.15", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.3", discount: null, priceOverride: null };
/** What was sent: walls, plus a ceiling upgrade the office pre-selected. */
const DOC: EstimateDoc = {
  title: "Interior repaint [TEST DATA]", jobType: "interior", contractType: "fixed_price", internalNotes: "SECRET-INTERNAL", customerNotes: null, poNumber: null,
  areasExcluded: null, preparationOverride: null, settings: SETTINGS,
  areas: [{ id: ROOM, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null, notes: null, customerDescription: null }],
  lines: [line(WALLS, "Walls – roll & cut", "3000"), line(CEILING, "Ceilings – roll & cut", "500", { isOptional: true, optionSelected: true })],
  costItems: [],
};
const ESTIMATE = {
  id: EST, number: 5001, title: DOC.title, customerId: CUSTOMER, propertyId: uuid(40), opportunityId: null, status: "sent", jobType: "interior", contractType: "fixed_price",
  revision: 1, ...SETTINGS, internalNotes: DOC.internalNotes, customerNotes: null, poNumber: null, areasExcluded: null, preparationOverride: null,
  validUntil: new Date("2026-10-30T07:00:00.000Z"), sentAt: V0, acceptedAt: null, updatedAt: V0,
};
const OPEN_PROPOSAL = { id: PROPOSAL, estimateId: EST, revision: 1, token: TOKEN, status: "sent", snapshot: DOC, view: { version: 2 }, expiresAt: null };
const SIGNED = { name: "Pat Customer [TEST DATA]", email: "", signature: `data:image/png;base64,${"A".repeat(300)}`, agree: true, selectedOptionIds: [CEILING], message: "" };
const META = { ip: "203.0.113.9", userAgent: "Test browser" };

const writes = () => h.fake.calls.filter((c) => c.op !== "select");
const isClaim = (c: FakeCall) => c.op === "update" && c.table === "proposals" && setOf(c).status === "accepted";

/** Answers like the database would for one estimate with one proposal whose status the test controls. */
function database(state: { proposal: string; estimate: string; updatedAt?: Date; propertyId?: string | null }) {
  h.fake.otherwise((c) => {
    if (c.op === "select" && c.table === "estimates") return [{ ...ESTIMATE, status: state.estimate, updatedAt: state.updatedAt ?? V0, ...("propertyId" in state ? { propertyId: state.propertyId } : {}) }];
    if (c.op === "select" && c.table === "estimate_revisions") return [{ latest: 1 }];
    if (c.op === "insert" && c.table === "proposals") return [{ id: uuid(8), status: "sent", ...(c.args.values[0] as object) }];
    if (c.op === "update" && c.table === "proposals") {
      const to = setOf(c).status as string;
      if (to === "superseded") return [];
      // Each claim is conditional on the proposal still being open.
      if (state.proposal !== "sent" && state.proposal !== "viewed") return [];
      state.proposal = to;
      return [{ id: PROPOSAL, estimateId: EST }];
    }
    return [];
  });
}

beforeEach(() => {
  h.fake.reset();
  h.found = { proposals: OPEN_PROPOSAL, estimates: ESTIMATE, customers: { id: CUSTOMER, displayName: "Pat Customer [TEST DATA]", phone: null } };
  h.many = { estimateAreas: DOC.areas, estimateLines: DOC.lines };
  h.transactions = 0;
  h.notified = [];
  h.sold = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a customer signs", () => {
  it("claims the proposal before anything is written to the estimate, then locks it to exactly what was signed", async () => {
    database({ proposal: "sent", estimate: "sent" });
    const r = await acceptProposal(TOKEN, SIGNED, META);

    expect(h.transactions).toBe(1);
    expect(h.fake.find("select", "estimates")[0].args.for).toEqual(["update"]);
    const w = writes();
    expect(isClaim(w[0])).toBe(true);
    const claim = where(w[0]);
    expect(claim.sql).toMatch(/"proposals"\."status" in \(\$\d+, \$\d+\)/);
    expect(claim.params).toEqual(expect.arrayContaining([PROPOSAL, "sent", "viewed"]));

    const docWrite = w.findIndex((c) => c.op === "delete" && c.table === "estimate_lines");
    const locked = w.findIndex((c) => c.op === "update" && c.table === "estimates" && setOf(c).status === "accepted");
    expect(docWrite).toBeGreaterThan(0);
    expect(locked).toBeGreaterThan(docWrite);
    expect(setOf(w[locked])).toMatchObject({ status: "accepted", acceptedAt: NOW, updatedAt: NOW, internalNotes: "SECRET-INTERNAL" });
    // The upgrade they ticked is written in as chosen.
    const lines = h.fake.find("insert", "estimate_lines")[0].args.values[0] as { id: string; optionSelected: boolean }[];
    expect(lines.find((l) => l.id === CEILING)?.optionSelected).toBe(true);

    expect(r.totals).toEqual(proposalTotals(DOC, [CEILING]));
    expect(h.sold).toHaveLength(1);
    expect(h.notified).toEqual([["accepted", PROPOSAL, { actorId: null }]]);
  });

  it("writes nothing when the claim is lost, so newer edits to the estimate survive", async () => {
    database({ proposal: "superseded", estimate: "sent" });
    await expect(acceptProposal(TOKEN, SIGNED, META)).rejects.toThrow("This proposal has already been accepted or replaced.");
    expect(writes()).toHaveLength(1);
    expect(h.fake.find("update", "estimates")).toEqual([]);
    expect(h.fake.find("delete", "estimate_lines")).toEqual([]);
    expect(h.sold).toEqual([]);
    expect(h.notified).toEqual([]);
  });

  it("never sells an estimate twice", async () => {
    database({ proposal: "sent", estimate: "accepted" });
    await expect(acceptProposal(TOKEN, SIGNED, META)).rejects.toThrow(EstimateLockedError);
    expect(h.fake.find("delete", "estimate_lines")).toEqual([]);
    expect(h.sold).toEqual([]);
  });

  it("records a signature made in person on a staff member's device", async () => {
    database({ proposal: "sent", estimate: "sent" });
    await acceptProposal(TOKEN, SIGNED, { ...META, staffDevice: OWNER });
    const [audit] = h.fake.find("insert", "audit_log").map((c) => c.args.values[0] as { action: string; actorId: string | null; after: Record<string, unknown> });
    expect(audit).toMatchObject({ action: "proposal.accept", actorId: null, after: { method: "online", signedInPerson: true, staffDevice: { userId: "owner-1", name: "Owner (Dev)" } } });
    const activity = h.fake.find("insert", "activities")[0].args.values[0] as { body: string; meta: Record<string, unknown> };
    expect(activity.body).toContain("accepted and signed by Pat Customer [TEST DATA] in person, on Owner (Dev)'s device");
    expect(activity.meta).toMatchObject({ signedOnDeviceOf: "owner-1" });
    // The staff member was there, so isn't sent a notification about it.
    expect(h.notified).toEqual([["accepted", PROPOSAL, { actorId: "owner-1" }]]);
  });

  it("an ordinary online signature says nothing about a device", async () => {
    database({ proposal: "sent", estimate: "sent" });
    await acceptProposal(TOKEN, SIGNED, META);
    const [audit] = h.fake.find("insert", "audit_log").map((c) => c.args.values[0] as { after: Record<string, unknown> });
    expect(audit.after).not.toHaveProperty("signedInPerson");
    expect((h.fake.find("insert", "activities")[0].args.values[0] as { body: string }).body).not.toContain("device");
  });
});

describe("a signature and a decline at the same time", () => {
  it("leave one clean outcome: the decline got there first, so the signature changes nothing", async () => {
    const state = { proposal: "viewed", estimate: "sent" };
    database(state);
    const [accepted, declined] = await Promise.allSettled([acceptProposal(TOKEN, SIGNED, META), declineProposal(TOKEN, "Too dear")]);
    expect(declined.status).toBe("fulfilled");
    expect(accepted).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: "This proposal has already been accepted or replaced." }) });
    expect(state.proposal).toBe("declined");
    expect(h.fake.find("delete", "estimate_lines")).toEqual([]);
    expect(h.fake.find("update", "estimates").map((c) => setOf(c).status)).toEqual(["declined"]);
    expect(h.sold).toEqual([]);
  });

  it("leave one clean outcome: once signed, a decline from an old tab is refused and the sale stands", async () => {
    const state = { proposal: "sent", estimate: "sent" };
    database(state);
    await acceptProposal(TOKEN, SIGNED, META);
    h.fake.reset();
    database({ ...state, estimate: "accepted" });
    await expect(declineProposal(TOKEN, "Changed my mind")).rejects.toThrow("This proposal is no longer open.");
    expect(state.proposal).toBe("accepted");
    expect(h.fake.find("update", "estimates")).toEqual([]);
    expect(h.fake.find("insert", "activities")).toEqual([]);
  });
});

describe("declining", () => {
  it("is a conditional claim on an open proposal, and never touches an accepted estimate", async () => {
    database({ proposal: "viewed", estimate: "sent" });
    await declineProposal(TOKEN, "  Going with someone else  ");
    expect(h.transactions).toBe(1);
    const [claim] = h.fake.find("update", "proposals");
    expect(setOf(claim)).toMatchObject({ status: "declined", declineReason: "Going with someone else" });
    expect(where(claim).params).toEqual(expect.arrayContaining(["sent", "viewed"]));
    const [est] = h.fake.find("update", "estimates");
    expect(setOf(est)).toEqual({ status: "declined", updatedAt: NOW });
    expect(where(est).sql).toMatch(/"estimates"\."status" <> \$\d+/);
    expect(where(est).params).toContain("accepted");
    expect(h.fake.find("insert", "activities")).toHaveLength(1);
    expect(h.notified).toEqual([["declined", PROPOSAL]]);
  });

  it("refuses a proposal that closed in the meantime, writing nothing", async () => {
    database({ proposal: "withdrawn", estimate: "sent" });
    await expect(declineProposal(TOKEN, "")).rejects.toThrow("This proposal is no longer open.");
    expect(writes()).toHaveLength(1);
    expect(h.notified).toEqual([]);
  });
});

describe("withdrawing", () => {
  it("only withdraws an open proposal and never changes the estimate", async () => {
    database({ proposal: "sent", estimate: "sent" });
    await withdrawProposal(PROPOSAL, "owner-1");
    const [claim] = h.fake.find("update", "proposals");
    expect(setOf(claim)).toEqual({ status: "withdrawn" });
    expect(where(claim).params).toEqual(expect.arrayContaining(["sent", "viewed"]));
    expect(h.fake.find("update", "estimates")).toEqual([]);
    expect((h.fake.find("insert", "audit_log")[0].args.values[0] as { action: string }).action).toBe("proposal.withdraw");
  });

  it("refuses one that was signed first", async () => {
    database({ proposal: "accepted", estimate: "accepted" });
    await expect(withdrawProposal(PROPOSAL, "owner-1")).rejects.toThrow("Only open proposals can be withdrawn.");
    expect(h.fake.find("insert", "audit_log")).toEqual([]);
  });
});

describe("sending", () => {
  it("refuses to send from an out-of-date screen", async () => {
    database({ proposal: "sent", estimate: "draft", updatedAt: new Date("2026-10-20T17:05:00.000Z") });
    await expect(sendProposal(EST, { email: false, to: "", message: "", expectedUpdatedAt: V0.toISOString() }, OWNER)).rejects.toThrow(STALE);
    expect(writes()).toEqual([]);
  });

  it("freezes the saved copy under the lock and stamps the proposal with the estimate's new version", async () => {
    database({ proposal: "sent", estimate: "draft" });
    const r = await sendProposal(EST, { email: false, to: "", message: "", expectedUpdatedAt: V0.toISOString() }, OWNER);
    expect(h.transactions).toBe(1);
    expect(r.updatedAt).toBe(NOW.toISOString());
    const proposal = h.fake.find("insert", "proposals")[0].args.values[0] as { sentAt: Date; snapshot: EstimateDoc };
    expect(proposal.sentAt).toEqual(NOW);
    expect(proposal.snapshot.lines.map((l) => l.id)).toEqual([WALLS, CEILING]);
    const sent = h.fake.find("update", "estimates").map(setOf).find((s) => s.status === "sent");
    // Valid for 30 days from the day it's sent, to the end of Nov 20 in Vancouver (UTC−7 from November 2026).
    expect(sent).toEqual({ status: "sent", sentAt: NOW, validUntil: new Date("2026-11-21T06:59:59.999Z"), updatedAt: NOW });
  });

  it("needs the job address before anything is frozen", async () => {
    database({ proposal: "sent", estimate: "draft", propertyId: null });
    await expect(sendProposal(EST, { email: false, to: "", message: "" }, OWNER)).rejects.toThrow("Pick the job address at the top of the estimate first.");
    await expect(acceptProposalForCustomer(EST, { name: "Phone Customer [TEST DATA]", method: "phone" }, OWNER)).rejects.toThrow("Pick the job address");
    expect(writes()).toEqual([]);
  });

  it("sends a surface priced at $0 only when the sender confirms it's meant", async () => {
    database({ proposal: "sent", estimate: "draft" });
    // Trim was added but never measured: no quantity and no price of its own.
    h.many = { ...h.many, estimateLines: [...DOC.lines, line(uuid(9), "Trim – brush", "0", { quantity: "0", overridePrice: null })] };
    await expect(sendProposal(EST, { email: false, to: "", message: "" }, OWNER)).rejects.toThrow(
      "A surface has no price yet (Living room – Trim – brush), so the customer would see the work promised for $0. Measure it, or confirm it's meant.",
    );
    expect(writes()).toEqual([]);
    await sendProposal(EST, { email: false, to: "", message: "", allowUnpriced: true }, OWNER);
    expect(h.fake.find("insert", "proposals")).toHaveLength(1);
  });
});

describe("Mark as accepted", () => {
  const input = { name: "Phone Customer [TEST DATA]", method: "phone", selectedOptionIds: [], note: "Wants a Monday start" };

  it("freezes and accepts in one transaction, exactly the copy that was on screen", async () => {
    database({ proposal: "sent", estimate: "sent" });
    const r = await acceptProposalForCustomer(EST, { ...input, expectedUpdatedAt: V0.toISOString() }, OWNER);
    expect(h.transactions).toBe(1);
    expect(r.projectId).toBe(uuid(77));
    expect(r.totals).toEqual(proposalTotals(DOC, []));
    const actions = h.fake.find("insert", "audit_log").map((c) => (c.args.values[0] as { action: string }).action);
    expect(actions).toEqual(["estimate.revision", "proposal.send", "proposal.accept_for_customer"]);
    const w = writes();
    expect(w.findIndex(isClaim)).toBeGreaterThan(w.findIndex((c) => c.op === "insert" && c.table === "proposals"));
    expect(w.findIndex((c) => c.op === "delete" && c.table === "estimate_lines")).toBeGreaterThan(w.findIndex(isClaim));
  });

  it("refuses when the estimate changed after the screen loaded it, writing nothing", async () => {
    database({ proposal: "sent", estimate: "sent", updatedAt: new Date("2026-10-20T17:05:00.000Z") });
    await expect(acceptProposalForCustomer(EST, { ...input, expectedUpdatedAt: V0.toISOString() }, OWNER)).rejects.toThrow(STALE);
    expect(writes()).toEqual([]);
    expect(h.sold).toEqual([]);
  });

  it("shows the upgrades ticked as on the customer's page, with the same totals", async () => {
    const p = await acceptancePreview(EST, V0.toISOString());
    expect(p.options).toEqual([{ id: CEILING, title: expect.stringContaining("Ceilings – roll & cut"), area: "Living room", price: "500.00" }]);
    expect(p.initialSelection).toEqual([CEILING]);
    expect(p.totals).toEqual(proposalTotals(DOC, [CEILING]));
    expect(JSON.stringify(p)).not.toContain("SECRET-INTERNAL");
  });

  it("the preview also refuses an out-of-date screen or an accepted estimate", async () => {
    await expect(acceptancePreview(EST, "2026-10-20T16:00:00.000Z")).rejects.toThrow(STALE);
    h.found.estimates = { ...ESTIMATE, status: "accepted" };
    await expect(acceptancePreview(EST, V0.toISOString())).rejects.toThrow(EstimateLockedError);
  });
});

/**
 * A quote is valid from the day it's sent (audit A-EST-1). The expiry written when a proposal is
 * frozen, the customer's view, the estimate and the email all use the same instant, and an
 * expired proposal is never chased with a follow-up.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeErrorMessage } from "@/lib/action-error";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";
import type { FakeCall, FakeDb } from "@/test/fake-db";
import type { ProposalViewV2 } from "./proposal-view";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  /** What db.query.<table>.findFirst returns. */
  found: {} as Record<string, unknown>,
  rows: {} as Record<string, unknown[] | ((c: FakeCall) => unknown[])>,
  estimate: null as Record<string, unknown> | null,
  validDays: 30 as unknown,
  revision: 0,
  audits: [] as { action: string; entityId?: string | null; after?: unknown }[],
  emails: [] as { to: string; subject: string; text: string }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  h.fake.db.query = new Proxy({}, { get: (_t, table) => ({ findFirst: async () => h.found[String(table)], findMany: async () => [] }) });
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: { action: string }) => void h.audits.push(e) }));
vi.mock("@/lib/email", () => ({ sendEmail: async (m: { to: string; subject: string; text: string }) => (h.emails.push(m), { status: "logged", provider: "test" }) }));
vi.mock("./estimates", () => ({
  loadEstimate: async () => (h.estimate ? { estimate: h.estimate, doc: DOC } : null),
  lockEstimate: async () => h.estimate,
  insertRevision: async () => ++h.revision,
  // Versions are covered by proposals.test.ts; here the send time is the version.
  assertCurrentVersion: () => undefined,
  nextVersion: (_est: unknown, now = new Date()) => now,
  writeEstimateDoc: async () => undefined,
  EstimateLockedError: class extends Error {},
}));
vi.mock("./leads", () => ({ moveStage: async () => undefined, stageByKey: async () => ({ id: "stage" }) }));
vi.mock("./media", () => ({ currentDocuments: async () => [], visibleDocuments: () => [] }));
vi.mock("./notifications", () => ({ notifyLater: () => undefined, notifyProposalEvent: async () => undefined }));
vi.mock("./project-status", () => ({ createSoldProject: async () => null }));
vi.mock("./work-orders", () => ({ createWorkOrderForSale: async () => undefined }));
vi.mock("./settings", async () => {
  const { DEFAULT_PROPOSAL_TEMPLATE } = await import("@/db/seed-proposal-template");
  return {
    getCompany: async () => ({ name: "Grandview Painting Ltd.", displayName: "Grandview Painting", phone: "604-555-0199", email: "office@example.com" }),
    getPricing: async () => ({ estimateValidDays: h.validDays }),
    getProposalTemplate: async () => DEFAULT_PROPOSAL_TEMPLATE,
  };
});

const p = await import("./proposals");
const { sampleProposal } = await import("./proposal-sample");

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EST = uuid(1);
const CUSTOMER = uuid(2);
const PROPOSAL = uuid(3);
const LIVING = uuid(10);
const TOKEN = "A".repeat(20) + "b".repeat(20) + "_-9";
const ACTOR = { id: "owner-1", name: "Owner (Dev)" };

// Sent 9 am Feb 20 (PST). 30 days later is Mar 22, after the Mar 8 change to PDT (UTC-7).
const SENT = new Date("2026-02-20T17:00:00.000Z");
const EXPIRY = new Date("2026-03-23T06:59:59.999Z");

const WALLS: RateSnapshot = {
  rateId: uuid(500), rateVersion: 1, name: "Walls – roll & cut", unit: "sqft", basis: "units_per_hour", productionRate: "150", additionalCoatFactor: "0.85", defaultCoats: 2,
  laborCostPerHour: "45", billingRatePerHour: "80",
  material: { productId: uuid(600), productName: "Benjamin Moore Regal Select", coverage: "350", pricePerGallon: "70", containerGallons: "1" },
  materialWastePct: "0.1", otherCostPerUnit: "0", category: "Interior", customerLabel: null, proposalGroup: null,
};
const DOC: EstimateDoc = {
  title: "Interior repaint", jobType: "interior", contractType: "fixed_price", internalNotes: null, customerNotes: null, poNumber: null, areasExcluded: null, preparationOverride: null,
  settings: { pricingMethod: "billing_rate", laborCostPerHour: "45", billingRatePerHour: "80", targetMargin: "0.45", materialMarkupPct: "0.20", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.20", discount: null, priceOverride: null },
  areas: [{ id: LIVING, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null, notes: null, customerDescription: null }],
  lines: [
    {
      id: uuid(11), areaId: LIVING, description: WALLS.name, customerDescription: null, customerDetail: null, rateSnapshot: WALLS, quantity: "300", quantitySource: "manual",
      coats: 2, prepFactor: "1", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null, overrideHours: null, overridePrice: null, isOptional: false, optionSelected: false,
    },
  ],
  costItems: [],
};

/** Started in December with the old creation-day validity, sent in February. */
const estimateRow = (extra: Record<string, unknown> = {}) => ({
  id: EST, number: 5012, title: "Interior repaint", status: "draft", customerId: CUSTOMER, propertyId: null, opportunityId: null, revision: 0, jobType: "interior",
  createdAt: new Date("2025-12-01T18:00:00.000Z"), validUntil: new Date("2025-12-31T18:00:00.000Z"), ...extra,
});
const openRow = (extra: Record<string, unknown> = {}) => ({ id: PROPOSAL, token: TOKEN, status: "viewed", sentTo: "kim@example.com", estimateId: EST, expiresAt: EXPIRY, ...extra });

const inserted = (table: string) => h.fake.find("insert", table).map((c) => c.args.values?.[0] as Record<string, unknown>);
const sets = (table: string) => h.fake.find("update", table).map((c) => c.args.set?.[0] as Record<string, unknown>);
const viewOf = (row: Record<string, unknown>) => row.view as ProposalViewV2;
const linkOnly = { to: "", email: false };

beforeEach(() => {
  h.fake.reset();
  h.estimate = estimateRow();
  h.found = { estimates: estimateRow(), customers: { id: CUSTOMER, displayName: "[TEST DATA] Kim Lee", phone: "604-555-0100", email: "kim@example.com" } };
  h.rows = { "insert:proposals": (c) => [{ id: PROPOSAL, ...(c.args.values?.[0] as object) }] };
  h.validDays = 30;
  h.revision = 0;
  h.audits = [];
  h.emails = [];
  h.fake.otherwise((call) => {
    const r = h.rows[`${call.op}:${call.table}`];
    return typeof r === "function" ? r(call) : (r ?? []);
  });
});

describe("proposalExpired", () => {
  it("is open to the last millisecond of its last day, and only open proposals expire", () => {
    const after = new Date(EXPIRY.getTime() + 1);
    expect(p.proposalExpired({ status: "sent", expiresAt: EXPIRY }, EXPIRY)).toBe(false);
    expect(p.proposalExpired({ status: "sent", expiresAt: EXPIRY }, after)).toBe(true);
    expect(p.proposalExpired({ status: "viewed", expiresAt: EXPIRY }, after)).toBe(true);
    expect(p.proposalExpired({ status: "viewed", expiresAt: null }, after)).toBe(false);
    for (const status of ["accepted", "declined", "superseded", "withdrawn"]) expect(p.proposalExpired({ status, expiresAt: EXPIRY }, after), status).toBe(false);
  });
});

describe("freezing a proposal", () => {
  it("counts from the day it's sent, not the day the estimate was started", async () => {
    await p.sendProposal(EST, linkOnly, ACTOR, SENT);
    const [row] = inserted("proposals");
    expect(row).toMatchObject({ estimateId: EST, sentAt: SENT, expiresAt: EXPIRY });
    expect(viewOf(row).validUntil).toBe("Mar 22, 2026");
    expect(viewOf(row).issuedOn).toBe("Feb 20, 2026");
    // The estimate gets the same instant, so the editor shows the same date.
    expect(sets("estimates")).toEqual([expect.objectContaining({ status: "sent", sentAt: SENT, validUntil: EXPIRY })]);
    expect(h.audits.find((a) => a.action === "proposal.send")?.after).toMatchObject({ estimateId: EST, expiresAt: EXPIRY.toISOString() });
  });

  it("goes by the Vancouver day it was sent, even late in the evening", async () => {
    // 11:30 pm Feb 20 in Vancouver is already Feb 21 in UTC.
    await p.sendProposal(EST, linkOnly, ACTOR, new Date("2026-02-21T07:30:00.000Z"));
    expect(inserted("proposals")[0].expiresAt).toEqual(EXPIRY);
  });

  it("uses the company's 'valid for' days as set when it's sent", async () => {
    h.validDays = 14;
    await p.sendProposal(EST, linkOnly, ACTOR, SENT);
    // Mar 6, before the change: still PST (UTC-8).
    expect(inserted("proposals")[0].expiresAt).toEqual(new Date("2026-03-07T07:59:59.999Z"));
    expect(viewOf(inserted("proposals")[0]).validUntil).toBe("Mar 6, 2026");
  });

  it("gives a re-sent proposal a fresh date and supersedes the open one first", async () => {
    const resent = new Date("2026-03-02T18:00:00.000Z");
    const later = new Date("2026-04-02T06:59:59.999Z"); // Apr 1, end of day
    await p.sendProposal(EST, linkOnly, ACTOR, SENT);
    await p.sendProposal(EST, linkOnly, ACTOR, resent);
    expect(inserted("proposals").map((r) => [r.revision, r.expiresAt])).toEqual([[1, EXPIRY], [2, later]]);
    const writes = h.fake.calls.filter((c) => c.table === "proposals").map((c) => (c.op === "update" ? `${c.op}:${(c.args.set?.[0] as { status: string }).status}` : c.op));
    expect(writes).toEqual(["update:superseded", "insert", "update:superseded", "insert"]);
    expect(sets("estimates").map((s) => s.validUntil)).toEqual([EXPIRY, later]);
  });

  it("emails the same date the customer sees on the proposal", async () => {
    await p.sendProposal(EST, { to: "kim@example.com", email: true }, ACTOR, SENT);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].text).toContain("This proposal is valid until March 22, 2026.");
    expect(viewOf(inserted("proposals")[0]).validUntil).toBe("Mar 22, 2026");
  });

  it("drafts the Send email and the staff preview with the date it would get if sent now", async () => {
    for (const validUntil of [new Date("2025-12-31T18:00:00.000Z"), null]) {
      h.found.estimates = estimateRow({ validUntil });
      const draft = await p.proposalEmailDraft(EST, ACTOR, SENT);
      expect(draft?.body).toContain("This proposal is valid until March 22, 2026.");
      expect(draft?.body).not.toContain("2025");
    }
    expect((await p.draftProposal(EST, SENT))?.view.validUntil).toBe("Mar 22, 2026");
    expect(h.fake.find("insert", "proposals")).toEqual([]);
  });

  it("shows the Settings sample with the company's 'valid for' days", async () => {
    expect((await sampleProposal("interior", SENT)).view.validUntil).toBe("Mar 22, 2026");
    h.validDays = 14;
    expect((await sampleProposal("interior", SENT)).view.validUntil).toBe("Mar 6, 2026");
  });
});

describe("following up", () => {
  const NOW = new Date("2026-03-25T19:00:00.000Z");
  const message = "This proposal expired on Mar 22, 2026, so the customer can no longer accept it. Send an updated proposal from the estimate instead.";
  const followUp = { to: "kim@example.com", subject: "Re: Your painting proposal", body: "Just checking in." };

  it("leaves expired proposals off the Home list", async () => {
    expect(await p.followUpsDue(NOW)).toEqual([]);
    const select = h.fake.find("select", "proposals").at(-1)!;
    const q = new PgDialect({ casing: "snake_case" }).sqlToQuery(select.args.where[0] as SQL);
    const m = /\("proposals"\."expires_at" is null or "proposals"\."expires_at" >= \$(\d+)\)/.exec(q.sql);
    expect(m, q.sql).not.toBeNull();
    expect(q.params[Number(m![1]) - 1]).toBe(NOW.toISOString());
  });

  it("refuses to write or send a follow-up once the proposal has expired", async () => {
    h.rows["select:proposals"] = [openRow()];
    const after = new Date(EXPIRY.getTime() + 1);
    const draft = p.followUpDraft(PROPOSAL, ACTOR, after);
    await expect(draft).rejects.toThrow(message);
    expect(await draft.catch(safeErrorMessage)).toBe(message);
    await expect(p.sendProposalFollowUp(PROPOSAL, followUp, ACTOR, after)).rejects.toThrow(message);
    expect(h.emails).toEqual([]);
    expect(h.fake.find("insert", "outbound_messages")).toEqual([]);
  });

  it("can follow up until the last moment, and a follow-up never moves the date", async () => {
    h.rows["select:proposals"] = [openRow()];
    expect((await p.followUpDraft(PROPOSAL, ACTOR, EXPIRY)).body).toContain(`/share/p/${TOKEN}`);
    expect(await p.sendProposalFollowUp(PROPOSAL, followUp, ACTOR, EXPIRY)).toMatchObject({ status: "logged" });
    expect(h.emails).toHaveLength(1);
    expect(h.fake.find("update", "proposals")).toEqual([]);
    expect(h.fake.find("update", "estimates")).toEqual([]);
  });
});

describe("the customer's link", () => {
  const signed = { name: "Kim Lee", email: "", signature: `data:image/png;base64,${"A".repeat(300)}`, agree: true, selectedOptionIds: [] };
  const proposalRow = (expiresAt: Date) => ({ ...openRow({ expiresAt }), revision: 1, snapshot: DOC, view: { viewVersion: 2, options: [] }, selectedOptionIds: null, acceptedTotals: null });

  it("still says expired and still refuses a signature after the last day", async () => {
    h.found.proposals = proposalRow(new Date(Date.now() - 1000));
    expect((await p.getProposalForCustomer(TOKEN))?.status).toBe("expired");
    await expect(p.acceptProposal(TOKEN, signed, { ip: null, userAgent: null })).rejects.toThrow("This proposal has expired. Please contact us and we'll send an updated one.");
    h.found.proposals = proposalRow(new Date(Date.now() + 86_400_000));
    expect((await p.getProposalForCustomer(TOKEN))?.status).toBe("viewed");
  });
});

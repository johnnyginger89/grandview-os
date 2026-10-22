import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";
import type { FakeCall, FakeDb } from "@/test/fake-db";

type Audit = { action: string; entityId?: string | null; before?: unknown; after?: unknown };
const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as Audit[],
  memberships: [] as { crewId: string; isLead: boolean }[],
  stored: undefined as unknown,
  saved: [] as unknown[],
  rows: {} as Record<string, unknown[] | ((c: FakeCall) => unknown[])>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: Audit) => void h.audits.push(e) }));
vi.mock("./crews", () => ({ crewIdsForUser: async () => h.memberships }));
vi.mock("./estimates", () => ({ loadEstimate: async () => null }));
vi.mock("./schedule-settings", async () => {
  const { defaultScheduleSettings } = await import("@/lib/schedule/settings-schema");
  return { getScheduleSettings: async () => defaultScheduleSettings() };
});
vi.mock("./settings", async () => {
  const { DEFAULT_PROPOSAL_TEMPLATE } = await import("@/db/seed-proposal-template");
  return {
    getCompany: async () => ({ name: "Grandview Painting Ltd.", displayName: "Grandview Painting", phone: "604-555-0199" }),
    getProposalTemplate: async () => DEFAULT_PROPOSAL_TEMPLATE,
    getSetting: async (_key: string, fallback: unknown) => h.stored ?? fallback,
    setSetting: async (_key: string, value: unknown) => void h.saved.push(value),
  };
});

const wo = await import("./work-orders");
type WorkOrderView = import("./work-order-view").WorkOrderView;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PROJECT = uuid(1);
const WO = uuid(2);
const CREW_A = uuid(3);
const CREW_B = uuid(4);
const LINK = uuid(5);
const PROPOSAL = uuid(6);
const LIVING = uuid(7);
const CHOSEN = uuid(8);
const DECLINED = uuid(9);
const ACTOR = { id: "owner-1" };
const NOW = new Date("2026-10-22T18:00:00Z");
const DAY = 86_400_000;
const TOKEN = "A".repeat(20) + "b".repeat(20) + "_-9";

// Same sentinels as the view tests: none may reach a crew.
const SENTINELS = ["987.65", "123.45", "SECRET-INTERNAL", "SECRET-AREA", "4321.09", "77.77", "0.4567", "2222.22", "6543.21"];

function snap(name: string, unit: RateSnapshot["unit"], product: string | null): RateSnapshot {
  return {
    rateId: uuid(500), rateVersion: 1, name, unit, basis: "units_per_hour", productionRate: "150", additionalCoatFactor: "0.85", defaultCoats: 2,
    laborCostPerHour: "987.65", billingRatePerHour: "123.45",
    material: product ? { productId: uuid(600), productName: product, coverage: "350", pricePerGallon: "77.77", containerGallons: "1" } : null,
    materialWastePct: "0.1", otherCostPerUnit: "0.03", category: "Interior", customerLabel: null, proposalGroup: null,
  };
}

function line(id: string, s: RateSnapshot, extra: Partial<EstimateDoc["lines"][number]> = {}): EstimateDoc["lines"][number] {
  return {
    id, areaId: LIVING, description: s.name, customerDescription: null, customerDetail: null, rateSnapshot: s, quantity: "300", quantitySource: "manual",
    coats: 2, prepFactor: "1", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null,
    overrideHours: "2222.22", overridePrice: "6543.21", isOptional: false, optionSelected: false, ...extra,
  };
}

const DOC: EstimateDoc = {
  title: "Interior repaint", jobType: "interior", contractType: "fixed_price", internalNotes: "SECRET-INTERNAL", customerNotes: null, poNumber: null,
  areasExcluded: "Garage", preparationOverride: null,
  settings: {
    pricingMethod: "target_margin", laborCostPerHour: "987.65", billingRatePerHour: "123.45", targetMargin: "0.4567", materialMarkupPct: "0.20",
    minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.20", discount: "0", priceOverride: null,
  },
  areas: [{ id: LIVING, parentId: null, name: "Living room", kind: "room", length: "12", width: "10", height: "8", notes: "SECRET-AREA", customerDescription: null }],
  lines: [
    line(uuid(11), snap("Walls – roll & cut", "sqft", "Benjamin Moore Regal Select"), { quantitySource: "walls", colour: "SW 7008 Alabaster", sheen: "Eggshell" }),
    // Proposal snapshots store options unselected; the signed choice comes from selectedOptionIds.
    line(CHOSEN, snap("Doors", "each", null), { quantity: "3", isOptional: true, customerDescription: "Paint 3 doors" }),
    line(DECLINED, snap("Ceilings", "sqft", null), { isOptional: true, customerDescription: "Ceiling (not chosen)" }),
  ],
  costItems: [{ id: uuid(700), kind: "subcontractor", description: "Hidden sub 4321.09", customerDescription: "Lift", cost: "4321.09", markupPct: "0.25", overridePrice: null, isOptional: false, optionSelected: false }],
};

const project = (extra: Record<string, unknown> = {}) => ({
  id: PROJECT, number: 3018, name: "[TEST DATA] Kim Lee – Interior repaint", status: "scheduled", customerId: uuid(20), propertyId: uuid(21),
  estimateId: uuid(22), proposalId: PROPOSAL, projectManagerId: null, ...extra,
});

const woRow = (extra: Record<string, unknown> = {}) => ({
  id: WO, projectId: PROJECT, number: 7001, title: "Interior repaint", status: "draft", currentVersion: 0, specialInstructions: "Start upstairs",
  equipment: null, safetyNotes: null, accessNotes: null, showCustomerPhone: false, checklist: [{ id: "c1", text: "Take before photos" }], crewId: null,
  createdBy: "owner-1", createdAt: NOW, updatedAt: NOW, ...extra,
});

const PROPERTY = { street: "1 Example St", unit: null, city: "Surrey", province: "BC", postalCode: "V3S 0A1", accessNotes: "Lockbox by the side door" };

/** The rows the view builder's sources come from. */
function sourceRows() {
  h.rows["select:projects"] = [project()];
  h.rows["select:proposals"] = [{ snapshot: DOC, selected: [CHOSEN] }];
  h.rows["select:customers"] = [{ name: "[TEST DATA] Kim Lee", phone: "604-555-0100" }];
  h.rows["select:contacts"] = [];
  h.rows["select:properties"] = [PROPERTY];
  h.rows["select:schedule_entries"] = [];
}

function view(extra: Partial<WorkOrderView> = {}): WorkOrderView {
  return {
    viewVersion: 1, number: "WO-7001", version: 1, issuedOn: "Oct 22, 2026", title: "Interior repaint", jobType: "interior", jobTypeLabel: "Interior",
    projectNumber: 3018, customerName: "[TEST DATA] Kim Lee", customerPhone: "604-555-0100", address: "1 Example St, Surrey, BC V3S 0A1", mapsUrl: null,
    accessNotes: null, crew: null, bookings: [], projectManager: null, scope: [], preparation: [], excluded: [],
    specialInstructions: [{ type: "p", text: "Start upstairs" }], equipment: [], safety: [], checklist: [], ...extra,
  };
}

const lastInsert = (table: string) => h.fake.find("insert", table).at(-1)?.args.values?.[0] as Record<string, unknown>;
const lastSet = (table: string) => h.fake.find("update", table).at(-1)?.args.set?.[0] as Record<string, unknown>;

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.memberships = [];
  h.stored = undefined;
  h.saved = [];
  h.rows = {};
  h.fake.otherwise((c) => {
    const r = h.rows[`${c.op}:${c.table}`];
    return typeof r === "function" ? r(c) : (r ?? []);
  });
});

describe("share-link tokens", () => {
  it("are 32 random bytes in base64url, stored only as their sha256", () => {
    const a = wo.newLinkToken();
    const b = wo.newLinkToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.token, "base64url")).toHaveLength(32);
    expect(a.tokenHash).toBe(sha256(a.token));
    expect(a.token).not.toBe(b.token);
    expect(wo.hashLinkToken(TOKEN)).toBe(sha256(TOKEN));
  });

  it("verify against the stored hash and reject anything else", () => {
    const a = wo.newLinkToken();
    expect(wo.tokenMatches(a.token, a.tokenHash)).toBe(true);
    expect(wo.tokenMatches(wo.newLinkToken().token, a.tokenHash)).toBe(false);
    expect(wo.tokenMatches(a.token, "not-a-hash")).toBe(false);
    expect(wo.isLinkTokenShaped(a.token)).toBe(true);
    for (const bad of ["", "short", `${a.token}x`, `${a.token.slice(0, 42)}/`, "../../../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaa"]) expect(wo.isLinkTokenShaped(bad), bad).toBe(false);
  });
});

describe("createShareLink", () => {
  const appUrl = process.env.APP_URL;
  afterEach(() => {
    process.env.APP_URL = appUrl;
  });

  it("stores the hash, returns the token once in the link and audits without it", async () => {
    process.env.APP_URL = "https://os.example.com/";
    h.rows["select:work_orders"] = [{ id: WO, projectId: PROJECT, status: "issued" }];
    h.rows["insert:work_order_links"] = [{ id: LINK }];
    const r = await wo.createShareLink({ workOrderId: WO, label: " Niko's crew ", days: 60 }, ACTOR, NOW);
    expect(r).toMatchObject({ linkId: LINK, projectId: PROJECT, expiresAt: "2026-12-21T18:00:00.000Z" });
    expect(r.url).toMatch(/^https:\/\/os\.example\.com\/share\/wo\/[A-Za-z0-9_-]{43}$/);
    const token = r.url.split("/share/wo/")[1];
    const stored = lastInsert("work_order_links");
    expect(stored).toMatchObject({ workOrderId: WO, tokenHash: sha256(token), label: "Niko's crew", expiresAt: new Date(NOW.getTime() + 60 * DAY), createdBy: "owner-1" });
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(h.audits).toEqual([expect.objectContaining({ action: "work_order.link_create", entityId: LINK })]);
    expect(JSON.stringify(h.audits)).not.toContain(token);
    expect(JSON.stringify(h.audits)).not.toContain(sha256(token));
  });

  it("only shares issued work orders, for 1 to 365 days", async () => {
    h.rows["select:work_orders"] = [{ id: WO, projectId: PROJECT, status: "draft" }];
    await expect(wo.createShareLink({ workOrderId: WO, label: "Crew", days: 30 }, ACTOR)).rejects.toThrow(/Issue the work order first/);
    h.rows["select:work_orders"] = [{ id: WO, projectId: PROJECT, status: "cancelled" }];
    await expect(wo.createShareLink({ workOrderId: WO, label: "Crew", days: 30 }, ACTOR)).rejects.toThrow(/cancelled/);
    await expect(wo.createShareLink({ workOrderId: WO, label: "Crew", days: 366 }, ACTOR)).rejects.toThrow();
    expect(h.fake.find("insert", "work_order_links")).toEqual([]);
  });
});

describe("getWorkOrderForToken", () => {
  const v1 = view({ version: 1 });
  const v2 = view({ version: 2, specialInstructions: [{ type: "p", text: "Start downstairs" }] });
  const linkRow = (extra: Record<string, unknown> = {}) => ({
    linkId: LINK, tokenHash: sha256(TOKEN), expiresAt: new Date(NOW.getTime() + 30 * DAY), revokedAt: null, lastOpenedVersion: null,
    workOrderId: WO, status: "issued", currentVersion: 2, projectStatus: "scheduled", ...extra,
  });
  beforeEach(() => {
    h.rows["select:work_order_versions"] = [{ version: 2, view: v2 }, { version: 1, view: v1 }];
  });

  it("ignores malformed tokens without touching the database", async () => {
    for (const bad of ["", "abc", `${TOKEN}=`, "' or 1=1 --"]) expect(await wo.getWorkOrderForToken(bad, { countOpen: true, now: NOW })).toBeNull();
    expect(h.fake.calls).toEqual([]);
  });

  it("looks the link up by hash and shows the current version, counting the open", async () => {
    h.rows["select:work_order_links"] = [linkRow()];
    const r = await wo.getWorkOrderForToken(TOKEN, { countOpen: true, now: NOW });
    expect(r).toEqual({ view: v2, update: null });
    const lookup = new PgDialect().sqlToQuery(h.fake.find("select", "work_order_links")[0].args.where[0] as never);
    expect(lookup.params).toEqual([sha256(TOKEN)]);
    expect(lastSet("work_order_links")).toMatchObject({ lastOpenedAt: NOW, lastOpenedVersion: 2 });
  });

  it("doesn't count staff opens", async () => {
    h.rows["select:work_order_links"] = [linkRow()];
    expect(await wo.getWorkOrderForToken(TOKEN, { countOpen: false, now: NOW })).not.toBeNull();
    expect(h.fake.find("update", "work_order_links")).toEqual([]);
  });

  it("highlights what changed since the version this link last opened", async () => {
    h.rows["select:work_order_links"] = [linkRow({ lastOpenedVersion: 1 })];
    const r = await wo.getWorkOrderForToken(TOKEN, { countOpen: true, now: NOW });
    expect(r?.update).toEqual({ fromVersion: 1, changed: ["specialInstructions"] });
    expect(lastSet("work_order_links")).toMatchObject({ lastOpenedVersion: 2 });
  });

  it("turns away unknown, revoked, expired, unissued and cancelled links alike", async () => {
    const cases: Record<string, Record<string, unknown> | null> = {
      unknown: null,
      "wrong hash": { tokenHash: sha256("something else") },
      revoked: { revokedAt: NOW },
      expired: { expiresAt: NOW },
      draft: { status: "draft", currentVersion: 0 },
      cancelled: { status: "cancelled" },
      "job cancelled": { projectStatus: "cancelled" },
    };
    for (const [name, extra] of Object.entries(cases)) {
      h.rows["select:work_order_links"] = extra ? [linkRow(extra)] : [];
      expect(await wo.getWorkOrderForToken(TOKEN, { countOpen: true, now: NOW }), name).toBeNull();
    }
    expect(h.fake.find("update", "work_order_links")).toEqual([]);
  });
});

describe("issueWorkOrder", () => {
  async function issueFirst(): Promise<WorkOrderView> {
    sourceRows();
    h.rows["select:work_orders"] = [woRow()];
    await wo.issueWorkOrder({ id: WO }, ACTOR);
    return lastInsert("work_order_versions").view as WorkOrderView;
  }

  it("freezes a crew-safe snapshot of the signed scope as version 1", async () => {
    const v = await issueFirst();
    expect(lastInsert("work_order_versions")).toMatchObject({ workOrderId: WO, version: 1, changeNote: null, issuedBy: "owner-1" });
    const json = JSON.stringify(v);
    for (const s of SENTINELS) expect(json, s).not.toContain(s);
    expect(json).not.toContain("$");
    expect(v).toMatchObject({ number: "WO-7001", version: 1, projectNumber: 3018, address: "1 Example St, Surrey, BC V3S 0A1", accessNotes: "Lockbox by the side door", customerPhone: null });
    const items = v.scope.flatMap((a) => a.items);
    expect(items.map((i) => i.title)).toEqual(["Walls – roll & cut", "Paint 3 doors"]);
    expect(items[0]).toMatchObject({ quantity: "352", unit: "sq ft", coats: 2, colour: "SW 7008 Alabaster", sheen: "Eggshell" });
    expect(v.excluded).toEqual(["Garage"]);
    expect(lastSet("work_orders")).toMatchObject({ status: "issued", currentVersion: 1 });
    expect(h.audits).toEqual([expect.objectContaining({ action: "work_order.issue", entityId: WO, after: expect.objectContaining({ version: 1 }) })]);
  });

  it("refuses a new version when nothing changed, and records what did change", async () => {
    const v1 = await issueFirst();
    h.fake.reset();
    h.audits = [];
    h.fake.otherwise((c) => {
      const r = h.rows[`${c.op}:${c.table}`];
      return typeof r === "function" ? r(c) : (r ?? []);
    });
    h.rows["select:work_order_versions"] = [{ version: 1, view: v1 }];
    h.rows["select:work_orders"] = [woRow({ status: "issued", currentVersion: 1 })];
    await expect(wo.issueWorkOrder({ id: WO }, ACTOR)).rejects.toThrow("Nothing has changed since version 1, so there's nothing new to issue.");
    expect(h.fake.find("insert", "work_order_versions")).toEqual([]);

    h.rows["select:work_orders"] = [woRow({ status: "issued", currentVersion: 1, specialInstructions: "Start downstairs" })];
    expect(await wo.issueWorkOrder({ id: WO, changeNote: " Start moved " }, ACTOR)).toMatchObject({ version: 2 });
    expect(lastInsert("work_order_versions")).toMatchObject({ version: 2, changeNote: "Start moved" });
    expect(h.audits.at(-1)?.after).toMatchObject({ version: 2, changed: ["specialInstructions"] });
  });

  it("won't issue a cancelled work order or one on a cancelled job", async () => {
    sourceRows();
    h.rows["select:work_orders"] = [woRow({ status: "cancelled" })];
    await expect(wo.issueWorkOrder({ id: WO }, ACTOR)).rejects.toThrow(/cancelled/);
    h.rows["select:work_orders"] = [woRow()];
    h.rows["select:projects"] = [project({ status: "cancelled" })];
    await expect(wo.issueWorkOrder({ id: WO }, ACTOR)).rejects.toThrow(/job was cancelled/);
    expect(h.fake.find("insert", "work_order_versions")).toEqual([]);
  });

  it("works for a job brought over without a signed estimate (instructions only)", async () => {
    sourceRows();
    h.rows["select:proposals"] = [];
    h.rows["select:work_orders"] = [woRow()];
    await wo.issueWorkOrder({ id: WO }, ACTOR);
    const v = lastInsert("work_order_versions").view as WorkOrderView;
    expect(v).toMatchObject({ scope: [], preparation: [], excluded: [], title: "Interior repaint", specialInstructions: [{ type: "p", text: "Start upstairs" }] });
  });

  it("shows the phone only when ticked and lists only the work order's crew bookings", async () => {
    sourceRows();
    h.rows["select:schedule_entries"] = [
      { kind: "work", phaseLabel: null, startDate: "2026-10-26", endDate: "2026-10-30", crewId: CREW_A, crewName: "[TEST DATA] Niko", worksSaturdays: false, crewNotes: "Park on the street" },
      { kind: "pressure_wash", phaseLabel: null, startDate: "2026-10-23", endDate: "2026-10-23", crewId: CREW_B, crewName: "[TEST DATA] PW", worksSaturdays: false, crewNotes: null },
    ];
    h.rows["select:crews"] = [{ name: "[TEST DATA] Niko" }];
    h.rows["select:crew_members"] = [{ name: "Niko (Dev)" }];
    h.rows["select:work_orders"] = [woRow({ crewId: CREW_A, showCustomerPhone: true })];
    await wo.issueWorkOrder({ id: WO }, ACTOR);
    const v = lastInsert("work_order_versions").view as WorkOrderView;
    expect(v.customerPhone).toBe("604-555-0100");
    expect(v.crew).toEqual({ name: "[TEST DATA] Niko", lead: "Niko (Dev)" });
    expect(v.bookings).toEqual([expect.objectContaining({ label: "Painting", workDays: 5, crewNotes: "Park on the street" })]);
  });
});

describe("creating, editing and cancelling", () => {
  const fields = { title: "Interior repaint", crewId: null, specialInstructions: "", equipment: "", safetyNotes: "", showCustomerPhone: false, checklist: [{ id: "c1", text: "Take before photos" }] };

  it("creates a draft that follows the property's access notes unless they're changed", async () => {
    sourceRows();
    h.rows["insert:work_orders"] = [{ id: WO, number: 7001 }];
    await wo.createWorkOrder({ ...fields, projectId: PROJECT, accessNotes: " Lockbox by the side door " }, ACTOR);
    expect(lastInsert("work_orders")).toMatchObject({ projectId: PROJECT, accessNotes: null, specialInstructions: null, createdBy: "owner-1" });
    await wo.createWorkOrder({ ...fields, projectId: PROJECT, accessNotes: "Use the back gate" }, ACTOR);
    expect(lastInsert("work_orders")).toMatchObject({ accessNotes: "Use the back gate" });
    expect(h.audits.map((a) => a.action)).toEqual(["work_order.create", "work_order.create"]);
  });

  it("starts every sold job with a draft for all crews and the default checklist", async () => {
    sourceRows();
    h.rows["insert:work_orders"] = [{ id: WO, number: 7001 }];
    expect(await wo.createWorkOrderForSale(PROJECT, null)).toBe(WO);
    expect(lastInsert("work_orders")).toMatchObject({ projectId: PROJECT, title: "[TEST DATA] Kim Lee – Interior repaint", crewId: null, createdBy: null });
    const checklist = lastInsert("work_orders").checklist as { id: string; text: string }[];
    expect(checklist.map((c) => c.text)).toHaveLength(7);
    expect(checklist.every((c) => /^[A-Za-z0-9_-]{1,40}$/.test(c.id))).toBe(true);
    expect(h.audits).toEqual([expect.objectContaining({ action: "work_order.create", entityId: WO, after: expect.objectContaining({ automatic: true }) })]);
  });

  it("leaves a sale alone when switched off, already done, cancelled, or failing", async () => {
    sourceRows();
    h.stored = { createOnSale: false };
    expect(await wo.createWorkOrderForSale(PROJECT, "owner-1")).toBeNull();
    h.stored = undefined;
    h.rows["select:work_orders"] = [{ id: uuid(99) }];
    expect(await wo.createWorkOrderForSale(PROJECT, "owner-1")).toBeNull();
    h.rows["select:work_orders"] = [];
    h.rows["select:projects"] = [project({ status: "cancelled" })];
    expect(await wo.createWorkOrderForSale(PROJECT, "owner-1")).toBeNull();
    expect(h.fake.find("insert", "work_orders")).toEqual([]);

    h.rows["select:projects"] = [project()];
    h.rows["insert:work_orders"] = () => {
      throw new Error("database down");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await wo.createWorkOrderForSale(PROJECT, "owner-1")).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("refuses cancelled jobs and inactive crews", async () => {
    sourceRows();
    h.rows["select:projects"] = [project({ status: "cancelled" })];
    await expect(wo.createWorkOrder({ ...fields, projectId: PROJECT, accessNotes: null }, ACTOR)).rejects.toThrow(/job was cancelled/);
    h.rows["select:projects"] = [project()];
    h.rows["select:crews"] = [{ id: CREW_A, active: false }];
    await expect(wo.createWorkOrder({ ...fields, crewId: CREW_A, projectId: PROJECT, accessNotes: null }, ACTOR)).rejects.toThrow(/inactive/);
    expect(h.fake.find("insert", "work_orders")).toEqual([]);
  });

  it("edits with an audit trail, but not once cancelled", async () => {
    sourceRows();
    h.rows["select:work_orders"] = [woRow()];
    await wo.updateWorkOrder({ ...fields, id: WO, specialInstructions: "Start downstairs", accessNotes: null }, ACTOR);
    expect(lastSet("work_orders")).toMatchObject({ specialInstructions: "Start downstairs" });
    expect(h.audits).toEqual([expect.objectContaining({ action: "work_order.update", before: expect.objectContaining({ specialInstructions: "Start upstairs" }), after: expect.objectContaining({ specialInstructions: "Start downstairs" }) })]);
    h.rows["select:work_orders"] = [woRow({ status: "cancelled" })];
    await expect(wo.updateWorkOrder({ ...fields, id: WO, accessNotes: null }, ACTOR)).rejects.toThrow(/cancelled/);
  });

  it("cancels once, and a second cancel changes nothing", async () => {
    h.rows["select:work_orders"] = [{ id: WO, projectId: PROJECT, status: "issued" }];
    expect(await wo.cancelWorkOrder({ id: WO }, ACTOR)).toEqual({ id: WO, projectId: PROJECT });
    expect(lastSet("work_orders")).toMatchObject({ status: "cancelled" });
    h.rows["select:work_orders"] = [{ id: WO, projectId: PROJECT, status: "cancelled" }];
    await wo.cancelWorkOrder({ id: WO }, ACTOR);
    expect(h.fake.find("update", "work_orders")).toHaveLength(1);
    expect(h.audits.map((a) => a.action)).toEqual(["work_order.cancel"]);
  });

  it("revokes a link once and audits it", async () => {
    h.rows["select:work_order_links"] = [{ id: LINK, workOrderId: WO, label: "Niko's crew", revokedAt: null, projectId: PROJECT }];
    expect(await wo.revokeShareLink({ linkId: LINK }, ACTOR)).toEqual({ projectId: PROJECT });
    expect(lastSet("work_order_links").revokedAt).toBeInstanceOf(Date);
    h.rows["select:work_order_links"] = [{ id: LINK, workOrderId: WO, label: "Niko's crew", revokedAt: NOW, projectId: PROJECT }];
    await wo.revokeShareLink({ linkId: LINK }, ACTOR);
    expect(h.fake.find("update", "work_order_links")).toHaveLength(1);
    expect(h.audits.map((a) => a.action)).toEqual(["work_order.link_revoke"]);
  });
});

describe("listWorkOrders", () => {
  it("lists links without their hashes and flags changes that aren't issued yet", async () => {
    // Version 1 as it was issued, when the instructions said "Start upstairs".
    sourceRows();
    h.rows["select:work_orders"] = [woRow()];
    await wo.issueWorkOrder({ id: WO }, ACTOR);
    const issued = lastInsert("work_order_versions").view as WorkOrderView;

    h.rows["select:work_orders"] = [woRow({ status: "issued", currentVersion: 1, specialInstructions: "Start downstairs" })];
    h.rows["select:work_order_versions"] = [{ workOrderId: WO, version: 1, issuedAt: NOW, changeNote: null, issuedByName: "Owner", view: issued }];
    h.rows["select:work_order_links"] = [
      { id: LINK, workOrderId: WO, tokenHash: sha256(TOKEN), label: "Niko's crew", createdAt: NOW, expiresAt: new Date(NOW.getTime() + DAY), revokedAt: null, openCount: 2, lastOpenedAt: NOW, lastOpenedVersion: 1 },
    ];
    const [dto] = await wo.listWorkOrders(PROJECT, NOW);
    expect(dto).toMatchObject({ number: "WO-7001", status: "issued", currentVersion: 1, crewName: null, issuedAt: NOW.toISOString(), pendingChanges: ["specialInstructions"] });
    expect(dto.fields.accessNotes).toBe("Lockbox by the side door");
    expect(dto.links).toEqual([expect.objectContaining({ id: LINK, status: "active", openCount: 2, lastOpenedVersion: 1 })]);
    expect(JSON.stringify(dto)).not.toContain("tokenHash");
    expect(JSON.stringify(dto)).not.toContain(sha256(TOKEN));
  });

  it("makes a newly chosen project manager the office contact from the next version", async () => {
    sourceRows();
    h.rows["select:work_orders"] = [woRow()];
    await wo.issueWorkOrder({ id: WO }, ACTOR);
    const issued = lastInsert("work_order_versions").view as WorkOrderView;
    expect(issued.projectManager).toBeNull();

    h.rows["select:projects"] = [project({ projectManagerId: "pm-1" })];
    h.rows["select:user"] = [{ name: "[TEST DATA] Pat PM", phone: "604-555-0177" }];
    h.rows["select:work_orders"] = [woRow({ status: "issued", currentVersion: 1 })];
    h.rows["select:work_order_versions"] = [{ workOrderId: WO, version: 1, issuedAt: NOW, changeNote: null, issuedByName: "Owner", view: issued }];
    const [dto] = await wo.listWorkOrders(PROJECT, NOW);
    expect(dto.pendingChanges).toEqual(["details"]);

    await wo.issueWorkOrder({ id: WO }, ACTOR);
    expect(lastInsert("work_order_versions")).toMatchObject({ version: 2, view: { projectManager: { name: "[TEST DATA] Pat PM", phone: "604-555-0177" } } });
  });
});

describe("crew access (/my-jobs)", () => {
  const P2 = uuid(31);
  const P3 = uuid(32);
  const E1 = uuid(41);
  const E2 = uuid(42);
  const E3 = uuid(43);

  it("finds nothing for someone in no crew, without querying", async () => {
    expect(await wo.workOrdersForCrewMember("painter-1")).toEqual([]);
    expect(await wo.workOrderIdsForFieldJobs({ id: "painter-1" }, [E1])).toEqual({});
    expect(h.fake.calls).toEqual([]);
  });

  it("maps each booking to its crew's work order, else the all-crews one", async () => {
    h.memberships = [{ crewId: CREW_A, isLead: false }];
    // First the projects the crew is booked on, then the bookings asked about.
    h.fake.queue({
      "select:schedule_entries": [
        [{ projectId: PROJECT }, { projectId: P2 }, { projectId: P3 }],
        [{ id: E1, projectId: PROJECT, crewId: CREW_A }, { id: E2, projectId: P2, crewId: CREW_A }, { id: E3, projectId: P3, crewId: CREW_A }],
      ],
    });
    h.rows["select:work_orders"] = [
      { id: uuid(51), number: 7003, title: "All crews", version: 1, projectId: PROJECT, crewId: null },
      { id: uuid(52), number: 7002, title: "Niko", version: 2, projectId: PROJECT, crewId: CREW_A },
      { id: uuid(53), number: 7001, title: "All crews", version: 1, projectId: P2, crewId: null },
    ];
    expect(await wo.workOrderIdsForFieldJobs({ id: "painter-1" }, [E1, E2, E3, "not-a-uuid"])).toEqual({ [E1]: uuid(52), [E2]: uuid(53) });
  });

  const issuedRow = (extra: Record<string, unknown> = {}) => ({ id: WO, projectId: PROJECT, crewId: CREW_A, status: "issued", currentVersion: 1, projectStatus: "scheduled", ...extra });

  it("gives crew members the current version, and the phone only to the lead", async () => {
    h.rows["select:work_orders"] = [issuedRow()];
    h.rows["select:work_order_versions"] = [{ version: 1, view: view() }];
    h.memberships = [{ crewId: CREW_A, isLead: false }];
    expect((await wo.getWorkOrderForCrewMember({ id: "painter-1" }, WO))?.view.customerPhone).toBeNull();
    h.memberships = [{ crewId: CREW_A, isLead: true }];
    expect(await wo.getWorkOrderForCrewMember({ id: "lead-1" }, WO)).toMatchObject({ isLead: true, view: { customerPhone: "604-555-0100" } });
    h.memberships = [{ crewId: CREW_B, isLead: true }];
    expect(await wo.getWorkOrderForCrewMember({ id: "other-1" }, WO)).toBeNull();
  });

  it("opens an all-crews work order only for crews booked on the job", async () => {
    h.rows["select:work_orders"] = [issuedRow({ crewId: null })];
    h.rows["select:work_order_versions"] = [{ version: 1, view: view() }];
    h.memberships = [{ crewId: CREW_B, isLead: false }];
    h.rows["select:schedule_entries"] = [];
    expect(await wo.getWorkOrderForCrewMember({ id: "painter-1" }, WO)).toBeNull();
    h.rows["select:schedule_entries"] = [{ crewId: CREW_B }];
    expect(await wo.getWorkOrderForCrewMember({ id: "painter-1" }, WO)).toMatchObject({ isLead: false });
  });

  it("hides drafts, cancelled work orders and cancelled jobs", async () => {
    h.memberships = [{ crewId: CREW_A, isLead: true }];
    h.rows["select:work_order_versions"] = [{ version: 1, view: view() }];
    for (const extra of [{ status: "draft", currentVersion: 0 }, { status: "cancelled" }, { projectStatus: "cancelled" }]) {
      h.rows["select:work_orders"] = [issuedRow(extra)];
      expect(await wo.getWorkOrderForCrewMember({ id: "lead-1" }, WO), JSON.stringify(extra)).toBeNull();
    }
    expect(await wo.getWorkOrderForCrewMember({ id: "lead-1" }, "not-a-uuid")).toBeNull();
  });
});

describe("work_orders setting", () => {
  it("falls back to the starter values when nothing valid is saved", async () => {
    expect((await wo.getWorkOrderSettings()).defaultLinkDays).toBe(60);
    h.stored = { defaultLinkDays: 9999 };
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await wo.getWorkOrderSettings()).defaultLinkDays).toBe(60);
    h.stored = { defaultChecklist: ["Only this"], defaultLinkDays: 30 };
    expect(await wo.getWorkOrderSettings()).toEqual({ defaultChecklist: ["Only this"], defaultLinkDays: 30, createOnSale: true, showHours: true, showPaint: true });
    h.stored = { defaultChecklist: [], defaultLinkDays: 30, createOnSale: false, showHours: false, showPaint: true };
    expect(await wo.getWorkOrderSettings()).toMatchObject({ createOnSale: false, showHours: false, showPaint: true });
  });

  it("saves validated values with an audit entry", async () => {
    await wo.saveWorkOrderSettings({ defaultChecklist: [" Walk the job "], defaultLinkDays: 90 }, ACTOR);
    expect(h.saved).toEqual([{ defaultChecklist: ["Walk the job"], defaultLinkDays: 90, createOnSale: true, showHours: true, showPaint: true }]);
    expect(h.audits).toEqual([expect.objectContaining({ action: "settings.work_orders" })]);
    await expect(wo.saveWorkOrderSettings({ defaultLinkDays: 0 }, ACTOR)).rejects.toThrow();
  });
});

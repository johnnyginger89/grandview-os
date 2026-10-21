import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";
import type { FakeCall, FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as { action: string; entityId?: string | null; after?: unknown }[],
  emails: [] as { to: string; subject: string; text: string }[],
  marked: [] as { projectId: string; note: string }[],
  notified: [] as { ids: string[]; title: string }[],
  doc: null as unknown,
  rows: {} as Record<string, unknown[] | ((c: FakeCall) => unknown[])>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: { action: string }) => void h.audits.push(e) }));
vi.mock("@/lib/email", () => ({ sendEmail: async (m: { to: string; subject: string; text: string }) => (h.emails.push(m), { status: "logged", provider: "test" }) }));
vi.mock("./readiness", () => ({ markColoursChosen: async (_tx: unknown, i: { projectId: string; note: string }) => (h.marked.push(i), ["colour_consult"]) }));
vi.mock("./notifications", () => ({
  notify: async (ids: string[], n: { title: string }) => void h.notified.push({ ids, title: n.title }),
  notifyLater: (task: () => Promise<void>) => void task(),
  officeRecipients: async (_extra: unknown, except?: string | null) => [{ id: "owner-1", role: "owner" }].filter((u) => u.id !== except),
}));
vi.mock("./schedule-settings", async () => {
  const { defaultScheduleSettings } = await import("@/lib/schedule/settings-schema");
  return { getScheduleSettings: async () => defaultScheduleSettings() };
});
vi.mock("./settings", () => ({
  getCompany: async () => ({ name: "Grandview Painting Ltd.", displayName: "Grandview Painting", phone: "604-555-0199" }),
  getSetting: async (_k: string, fallback: unknown) => fallback,
  setSetting: async () => undefined,
}));
vi.mock("./work-orders", () => ({ signedDocForProject: async () => h.doc }));

const c = await import("./colour-selections");

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PROJECT = uuid(1);
const SEL = uuid(2);
const OLD = uuid(3);
const KITCHEN = uuid(10);
const MAIN = uuid(11);
const BATH = uuid(12);
const TOKEN = "A".repeat(20) + "b".repeat(20) + "_-9";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SIGNATURE = `data:image/png;base64,${"A".repeat(300)}`;
const ACTOR = { id: "owner-1", name: "Owner (Dev)" };

function snap(name: string, opts: Partial<RateSnapshot> = {}): RateSnapshot {
  return {
    name, unit: "sqft", basis: "units_per_hour", productionRate: "150", additionalCoatFactor: "0.85", defaultCoats: 2,
    material: { productId: uuid(600), productName: "SW Duration Matte", coverage: "350", pricePerGallon: "70" },
    materialWastePct: "0.1", otherCostPerUnit: "0", category: "Interior", customerLabel: null, ...opts,
  };
}
type Line = EstimateDoc["lines"][number];
const line = (n: number, areaId: string | null, s: RateSnapshot, extra: Partial<Line> = {}): Line => ({
  id: uuid(n), areaId, description: s.name, rateSnapshot: s, quantity: "100", quantitySource: "manual", coats: 2,
  prepFactor: "1", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null,
  overrideHours: null, overridePrice: null, isOptional: false, optionSelected: false, ...extra,
});

const DOC = {
  title: "Repaint", jobType: "interior", contractType: "fixed_price",
  settings: { pricingMethod: "target_margin", laborCostPerHour: "45", billingRatePerHour: "75", targetMargin: "0.4", materialMarkupPct: "0.2", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.2" },
  areas: [
    { id: MAIN, parentId: null, name: "Main floor", kind: "area" },
    { id: KITCHEN, parentId: MAIN, name: "Kitchen", kind: "room" },
    { id: BATH, parentId: null, name: "Bathroom", kind: "room" },
  ],
  lines: [
    line(20, KITCHEN, snap("Walls – roll & cut"), { colour: "SW 7008 Alabaster", sheen: "Eggshell" }),
    line(21, KITCHEN, snap("Baseboards", { unit: "lnft", customerLabel: "Baseboards" })),
    line(22, BATH, snap("Ceiling"), { isOptional: true, optionSelected: false }),
    line(23, BATH, snap("Sanding", { category: "Prep", material: null })),
    line(24, null, snap("Repairs", { unit: "hour", material: null })),
    line(25, BATH, snap("Walls – roll & cut"), { customerDescription: "Bathroom walls (mould-resistant)" }),
  ],
  costItems: [],
} as unknown as EstimateDoc;

const project = (extra: Record<string, unknown> = {}) => ({ id: PROJECT, number: 3018, name: "[TEST DATA] Kim Lee – Interior repaint", status: "scheduled", customerId: uuid(30), propertyId: null, projectManagerId: null, ...extra });
const client = { name: "Kim Lee [TEST DATA]", email: "kim@example.com", phone: "604-555-0100", address: "1 Example St" };
const selRow = (extra: Record<string, unknown> = {}) => ({
  id: SEL, projectId: PROJECT, customerId: uuid(30), status: "sent", rows: [], client, notes: null, replacesId: null, tokenHash: sha(TOKEN),
  linkExpiresAt: new Date(Date.now() + 86_400_000), linkSentAt: new Date(), linkSentTo: "kim@example.com", signedName: null, signedAt: null, signature: null,
  signedVia: null, signedIp: null, signedUserAgent: null, acknowledged: null, documentHash: null, filledBy: null, createdBy: "owner-1", createdAt: new Date(), updatedAt: new Date(), ...extra,
});
const signInput = (extra: Record<string, unknown> = {}) => ({
  rows: [{ id: "r1", room: "Kitchen", surface: "Walls", colour: "Alabaster", code: "SW 7008", sheen: "Eggshell", lineId: uuid(20) }],
  client, notes: null, signedName: "Kim Lee", signature: SIGNATURE, agreeChange: true, agreeCoverage: true, ...extra,
});

const lastInsert = (table: string) => h.fake.find("insert", table).at(-1)?.args.values?.[0] as Record<string, unknown>;
const sets = (table: string) => h.fake.find("update", table).map((u) => u.args.set?.[0] as Record<string, unknown>);

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.emails = [];
  h.marked = [];
  h.notified = [];
  h.doc = DOC;
  h.rows = { "select:projects": [project()] };
  h.fake.otherwise((call) => {
    const r = h.rows[`${call.op}:${call.table}`];
    return typeof r === "function" ? r(call) : (r ?? []);
  });
});

describe("rowsFromEstimate", () => {
  it("lists each painted surface the customer bought, with its room and any colour already chosen", () => {
    const rows = c.rowsFromEstimate(DOC);
    expect(rows.map((r) => [r.room, r.surface, r.code, r.colour, r.sheen, r.lineId])).toEqual([
      ["Main floor › Kitchen", "Walls", "SW 7008", "Alabaster", "Eggshell", uuid(20)],
      ["Main floor › Kitchen", "Baseboards", "", "", "", uuid(21)],
      ["Bathroom", "Bathroom walls (mould-resistant)", "", "", "", uuid(25)],
    ]);
    expect(c.rowsFromEstimate(null)).toEqual([]);
  });
});

describe("starting a form", () => {
  it("returns the job's open form instead of making another", async () => {
    h.rows["select:colour_selections"] = [{ id: SEL }];
    expect(await c.startColourSelection(PROJECT, ACTOR)).toEqual({ id: SEL, projectId: PROJECT, created: false });
    expect(h.fake.find("insert", "colour_selections")).toEqual([]);
  });

  it("fills a new form from the signed estimate and the customer's details", async () => {
    h.rows["insert:colour_selections"] = [{ id: SEL }];
    h.rows["select:customers"] = [{ name: "Kim Lee [TEST DATA]", email: "kim@example.com", phone: "604-555-0100" }];
    await c.startColourSelection(PROJECT, ACTOR);
    const v = lastInsert("colour_selections");
    expect(v).toMatchObject({ projectId: PROJECT, customerId: uuid(30), replacesId: null, client: { name: "Kim Lee [TEST DATA]", email: "kim@example.com" } });
    expect((v.rows as unknown[]).length).toBe(3);
    expect(h.audits.map((a) => a.action)).toEqual(["colours.start"]);
  });

  it("starts a change from the signed colours, to replace them once signed", async () => {
    const signed = [{ id: "x", room: "Kitchen", surface: "Walls", colour: "Alabaster", code: "SW 7008", sheen: "Eggshell" }];
    let n = 0;
    h.rows["select:colour_selections"] = () => (n++ === 0 ? [] : [{ id: OLD, rows: signed, notes: "Front door stays" }]);
    h.rows["insert:colour_selections"] = [{ id: SEL }];
    await c.startColourSelection(PROJECT, ACTOR);
    expect(lastInsert("colour_selections")).toMatchObject({ replacesId: OLD, notes: "Front door stays", rows: [expect.objectContaining({ colour: "Alabaster" })] });
  });

  it("refuses a cancelled job", async () => {
    h.rows["select:projects"] = [project({ status: "cancelled" })];
    await expect(c.startColourSelection(PROJECT, ACTOR)).rejects.toThrow(/cancelled/);
  });
});

describe("the customer's link", () => {
  it("stores only the hash, and emails the link only when asked", async () => {
    h.rows["select:colour_selections"] = [selRow({ status: "draft", tokenHash: null })];
    const quiet = await c.createColourLink({ id: SEL, email: null }, ACTOR);
    const token = quiet.url.split("/share/c/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sets("colour_selections").at(-1)).toMatchObject({ status: "sent", tokenHash: sha(token) });
    expect(JSON.stringify(h.audits)).not.toContain(token);
    expect(h.emails).toEqual([]);

    const sent = await c.createColourLink({ id: SEL, email: { to: "kim@example.com", subject: "Choose your colours", body: "Hi Kim,\n[Colour form link]\nThanks" } }, ACTOR);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].text).toBe(`Hi Kim,\n${sent.url}\nThanks`);
    expect(sent.emailStatus).toBe("logged");
  });

  it("won't send a signed form again", async () => {
    h.rows["select:colour_selections"] = [selRow({ status: "signed" })];
    await expect(c.createColourLink({ id: SEL, email: null }, ACTOR)).rejects.toThrow(/signed/);
  });

  it("opens by hash, hides office details, and turns away bad, expired or withdrawn links", async () => {
    expect(await c.getColourFormForToken("short")).toBeNull();
    expect(h.fake.calls).toHaveLength(0);

    h.rows["select:colour_selections"] = [selRow()];
    const form = await c.getColourFormForToken(TOKEN);
    expect(form).toMatchObject({ id: SEL, status: "sent", projectNumber: 3018, link: null });
    expect(h.fake.find("select", "colour_selections")[0].args.where).toBeDefined();

    h.rows["select:colour_selections"] = [selRow({ linkExpiresAt: new Date(Date.now() - 1000) })];
    expect(await c.getColourFormForToken(TOKEN)).toBeNull();
    h.rows["select:colour_selections"] = [selRow({ status: "cancelled" })];
    expect(await c.getColourFormForToken(TOKEN)).toBeNull();
    // A signed copy stays readable from the link after it expires.
    h.rows["select:colour_selections"] = [selRow({ status: "signed", linkExpiresAt: new Date(Date.now() - 1000), signedAt: new Date(), signedName: "Kim Lee", signature: SIGNATURE, acknowledged: { changeWarning: "Old wording A", coverageWarning: "Old wording B" } })];
    expect(await c.getColourFormForToken(TOKEN)).toMatchObject({ status: "signed", warnings: { change: "Old wording A", coverage: "Old wording B" }, signed: { name: "Kim Lee" } });
  });
});

describe("signing", () => {
  it("freezes the form, replaces the old colours, ticks off the colour consult and tells the office", async () => {
    h.rows["select:colour_selections"] = [selRow({ replacesId: OLD })];
    h.rows["update:colour_selections"] = [{ id: SEL }];
    await c.signColourFormFromLink(TOKEN, signInput(), { ip: "203.0.113.9", userAgent: "Test browser" });
    const [claim, replaced] = sets("colour_selections");
    expect(claim).toMatchObject({ status: "signed", signedName: "Kim Lee", signedVia: "link", signedIp: "203.0.113.9", signature: SIGNATURE });
    expect(claim.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(claim.acknowledged).toMatchObject({ changeWarning: expect.stringMatching(/ordered/), coverageWarning: expect.stringMatching(/third coat/) });
    expect(replaced).toMatchObject({ status: "replaced" });
    expect(h.marked).toEqual([expect.objectContaining({ projectId: PROJECT, note: expect.stringMatching(/^Colours signed by Kim Lee/) })]);
    expect(lastInsert("activities")).toMatchObject({ customerId: uuid(30), type: "system", body: expect.stringMatching(/signed by Kim Lee \(online\)/) });
    expect(h.audits.map((a) => a.action)).toEqual(["colours.sign"]);
    expect(h.notified).toEqual([{ ids: ["owner-1"], title: "Kim Lee [TEST DATA] signed their colours" }]);
  });

  it("refuses a second signature, an empty form and missing ticks", async () => {
    h.rows["select:colour_selections"] = [selRow()];
    h.rows["update:colour_selections"] = [];
    await expect(c.signColourFormFromLink(TOKEN, signInput(), { ip: null, userAgent: null })).rejects.toThrow(/already been signed/);
    await expect(c.signColourFormFromLink(TOKEN, signInput({ rows: [{ id: "r1", room: "Kitchen", surface: "Walls", colour: "", code: "", sheen: "Eggshell" }] }), { ip: null, userAgent: null })).rejects.toThrow(/at least one colour/);
    await expect(c.signColourFormFromLink(TOKEN, signInput({ agreeCoverage: false }), { ip: null, userAgent: null })).rejects.toThrow(/whites/);
    h.rows["select:colour_selections"] = [selRow({ status: "signed" })];
    await expect(c.signColourSelectionOnDevice(SEL, signInput(), ACTOR)).rejects.toThrow(/already been signed/);
  });

  it("records an in-person signature against the person who filled it in", async () => {
    h.rows["select:colour_selections"] = [selRow({ status: "draft", tokenHash: null })];
    h.rows["update:colour_selections"] = [{ id: SEL }];
    await c.signColourSelectionOnDevice(SEL, signInput(), ACTOR);
    expect(sets("colour_selections")[0]).toMatchObject({ signedVia: "device", filledBy: "owner-1" });
    expect(lastInsert("activities").body).toMatch(/in person with Owner \(Dev\)/);
    // The person who was there isn't told about their own signing.
    expect(h.notified).toEqual([{ ids: [], title: "Kim Lee [TEST DATA] signed their colours" }]);
  });
});

describe("the colour consultant", () => {
  it("only reaches a job through a colour-consult booking of their own crew", async () => {
    expect(await c.colourConsultProject("painter-1", "not-a-uuid")).toBeNull();
    h.rows["select:schedule_entries"] = [];
    expect(await c.colourConsultProject("painter-1", uuid(40))).toBeNull();
    h.rows["select:schedule_entries"] = [{ projectId: PROJECT }];
    expect(await c.colourConsultProject("painter-1", uuid(40))).toBe(PROJECT);
  });
});

import { describe, expect, it } from "vitest";
import { LEAD_CHANNELS } from "@/db/schema/crm";
import {
  applyFilters,
  applyPatch,
  BULK_LIMIT,
  CHANNEL_LABELS,
  COLUMNS,
  daysInStage,
  decodeListPrefs,
  DEFAULT_FILTERS,
  encodeListPrefs,
  followUpInstant,
  groupExcluded,
  groupRows,
  isFollowUpDue,
  isStale,
  mailtoHref,
  matchesSearch,
  NONE,
  parseListParams,
  rowValue,
  setColumnVisible,
  sortRows,
  sumValues,
  telHref,
  toSearchParams,
  visibleColumns,
  type ColumnKey,
  type Ctx,
  type ListFilters,
  type ListPrefs,
  type PipelineRow,
  type StageInfo,
} from "./list-view";

const STAGES: StageInfo[] = [
  { id: "s-new", key: "new_lead", name: "New Lead – To Contact", kind: "open", color: "amber", position: 1, staleAfterDays: 1 },
  { id: "s-contacted", key: "contacted", name: "Contacted", kind: "open", color: "sky", position: 2, staleAfterDays: 3 },
  { id: "s-booked", key: "estimate_booked", name: "Estimate Booked", kind: "open", color: "blue", position: 3, staleAfterDays: null },
  { id: "s-won", key: "won", name: "Won", kind: "won", color: "emerald", position: 8, staleAfterDays: null },
  { id: "s-lost", key: "lost", name: "Lost", kind: "lost", color: "rose", position: 9, staleAfterDays: null },
];
const stage = (key: string) => STAGES.find((s) => s.key === key)!;
const NOW = new Date("2026-10-21T19:00:00.000Z");
const ctx: Ctx = { now: NOW, stagesById: new Map(STAGES.map((s) => [s.id, s])) };

let seq = 1000;
function row(over: Partial<PipelineRow> & { stage?: string } = {}): PipelineRow {
  const s = stage(over.stage ?? "new_lead");
  const rest: Partial<PipelineRow> & { stage?: string } = { ...over };
  delete rest.stage;
  seq += 1;
  return {
    id: `id-${seq}`,
    number: seq,
    title: "t",
    customerId: `c-${seq}`,
    customerName: `[TEST DATA] Lead ${seq}`,
    customerType: "residential",
    stageId: s.id,
    stageKey: s.key,
    stageKind: s.kind,
    stageChangedAt: "2026-10-20T19:00:00.000Z",
    createdAt: "2026-10-01T19:00:00.000Z",
    closedAt: s.kind === "open" ? null : "2026-10-20T19:00:00.000Z",
    estimateVisitAt: null,
    firstViewedAt: null,
    nextFollowUpAt: null,
    lastContactedAt: null,
    lastActivityAt: null,
    projectTypes: [],
    source: null,
    channel: null,
    timeline: null,
    lostReason: null,
    contactName: null,
    email: null,
    phone: null,
    street: null,
    unit: null,
    city: null,
    propertyType: null,
    estimatorId: null,
    estimatorName: null,
    estimatedValue: null,
    estimateId: null,
    estimateTotal: null,
    estimateStatus: null,
    ...rest,
  };
}
const filters = (f: Partial<ListFilters> = {}): ListFilters => ({ ...DEFAULT_FILTERS, ...f });

describe("parseListParams", () => {
  it("gives defaults for an empty query", () => {
    expect(parseListParams({})).toEqual({ view: undefined, closed: "30d", filters: DEFAULT_FILTERS, sort: undefined, group: undefined });
  });

  it("falls back on invalid enums", () => {
    const s = parseListParams({ view: "grid", closed: "7d", status: "maybe", df: "x", sort: "password", dir: "sideways", group: "city" });
    expect(s.view).toBeUndefined();
    expect(s.closed).toBe("30d");
    expect(s.filters.status).toBe("all");
    expect(s.filters.dateField).toBe("created");
    expect(s.sort).toBeUndefined();
    expect(s.group).toBeUndefined();
  });

  it("reads valid values", () => {
    const s = parseListParams({ view: "list", closed: "all", status: "won", sort: "followUp", dir: "desc", group: "none", due: "1", unopened: "1" });
    expect(s).toMatchObject({ view: "list", closed: "all", sort: { col: "followUp", dir: "desc" }, group: "none" });
    expect(s.filters).toMatchObject({ status: "won", dueOnly: true, unopenedOnly: true });
  });

  it("accepts repeated and comma-separated arrays", () => {
    expect(parseListParams({ stage: ["contacted", "won"] }).filters.stages).toEqual(["contacted", "won"]);
    expect(parseListParams({ stage: "contacted,won" }).filters.stages).toEqual(["contacted", "won"]);
    expect(parseListParams({ stage: ["contacted,won", "won"] }).filters.stages).toEqual(["contacted", "won"]);
    expect(parseListParams({ stage: "Contacted;drop table" }).filters.stages).toEqual([]);
    // Sources are named by the owner and may contain commas, so they're only ever repeated.
    expect(parseListParams({ source: "Realtor, Property Mgr" }).filters.sources).toEqual(["Realtor, Property Mgr"]);
    expect(parseListParams({ estimator: `abc,${NONE}` }).filters.estimators).toEqual(["abc", NONE]);
  });

  it("caps the number and length of tokens", () => {
    const many = Array.from({ length: 80 }, (_, i) => `s${i}`);
    expect(parseListParams({ source: many }).filters.sources).toHaveLength(50);
    expect(parseListParams({ source: "x".repeat(101) }).filters.sources).toEqual([]);
  });

  it("trims q and cuts it to 100 characters", () => {
    expect(parseListParams({ q: "  ann  " }).filters.q).toBe("ann");
    expect(parseListParams({ q: "a".repeat(150) }).filters.q).toHaveLength(100);
    expect(parseListParams({ q: ["first", "second"] }).filters.q).toBe("first");
  });

  it("drops invalid dates and swaps from/to", () => {
    expect(parseListParams({ from: "2026-02-30" }).filters.from).toBeNull();
    expect(parseListParams({ from: "1999-12-31" }).filters.from).toBeNull();
    expect(parseListParams({ from: "2026-10-1" }).filters.from).toBeNull();
    const s = parseListParams({ from: "2026-10-22", to: "2026-10-01" });
    expect([s.filters.from, s.filters.to]).toEqual(["2026-10-01", "2026-10-22"]);
  });

  it("ignores an unknown sort column", () => {
    expect(parseListParams({ sort: "email" }).sort).toBeUndefined();
    expect(parseListParams({ sort: "constructor" }).sort).toBeUndefined();
  });
});

describe("toSearchParams", () => {
  it("omits defaults", () => {
    expect(toSearchParams(parseListParams({})).toString()).toBe("");
  });

  it("round-trips parseListParams", () => {
    const qs = "view=list&closed=90d&q=ann&status=open&stage=contacted&stage=won&source=Realtor%2C+Mgr&channel=phone&estimator=__none&df=visit&from=2026-10-01&to=2026-10-22&due=1&unopened=1&sort=followUp&dir=desc&group=none";
    const parsed = parseListParams(Object.fromEntries([...new URLSearchParams(qs).keys()].map((k) => [k, new URLSearchParams(qs).getAll(k)])));
    expect(toSearchParams(parsed).toString()).toBe(qs);
  });
});

describe("list preferences cookie", () => {
  const prefs: ListPrefs = { v: 1, view: "list", hidden: ["email"], shown: ["closed"], collapsed: ["won", "lost", "contacted"], sort: { col: "followUp", dir: "asc" }, group: "stage" };

  it("round-trips", () => {
    const raw = encodeListPrefs(prefs);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeListPrefs(raw)).toEqual(prefs);
  });

  it("gives defaults for garbage, oversized, wrong version or non-base64 values", () => {
    const defaults = { v: 1, hidden: [], shown: [] };
    expect(decodeListPrefs(undefined)).toEqual(defaults);
    expect(decodeListPrefs("")).toEqual(defaults);
    expect(decodeListPrefs("%%%not base64%%%")).toEqual(defaults);
    expect(decodeListPrefs(btoa("not json"))).toEqual(defaults);
    expect(decodeListPrefs("A".repeat(5000))).toEqual(defaults);
    expect(decodeListPrefs(btoa(JSON.stringify({ ...prefs, v: 2 })))).toEqual(defaults);
    expect(decodeListPrefs(btoa(JSON.stringify([1, 2])))).toEqual(defaults);
  });

  it("drops unknown columns and bad stage keys, and keeps the rest", () => {
    const raw = btoa(JSON.stringify({ v: 1, view: "table", hidden: ["email", "ssn", 4, "name"], shown: ["closed", "email"], collapsed: ["won", "Bad Key", "<script>"], sort: { col: "phone", dir: "asc" } }));
    expect(decodeListPrefs(raw)).toEqual({ v: 1, hidden: ["email"], shown: ["closed"], collapsed: ["won"] });
  });

  it("setColumnVisible keeps only overrides", () => {
    let p: ListPrefs = { v: 1, hidden: [], shown: [] };
    p = setColumnVisible(p, "email", false);
    p = setColumnVisible(p, "closed", true);
    p = setColumnVisible(p, "name", false);
    expect(p).toMatchObject({ hidden: ["email"], shown: ["closed"] });
    p = setColumnVisible(setColumnVisible(p, "email", true), "closed", false);
    expect(p).toMatchObject({ hidden: [], shown: [] });
  });
});

describe("visibleColumns", () => {
  const keys = (p: ListPrefs, includeMoney: boolean) => visibleColumns(p, { includeMoney }).map((c) => c.key);

  it("leaves out money columns without estimates.read, whatever the cookie says", () => {
    const p: ListPrefs = { v: 1, hidden: [], shown: ["estimateStatus"] };
    expect(keys(p, false)).not.toContain("value");
    expect(keys(p, false)).not.toContain("estimateStatus");
    expect(keys(p, true)).toContain("value");
    expect(keys(p, true)).toContain("estimateStatus");
  });

  it("never hides name or stage", () => {
    const p = { v: 1, hidden: ["name", "stage"] as ColumnKey[], shown: [] } as ListPrefs;
    expect(keys(p, true)).toEqual(expect.arrayContaining(["name", "stage"]));
  });

  it("shows a newly added default column despite older prefs", () => {
    // Older prefs only list overrides, so any default-visible column not in `hidden` shows.
    const p: ListPrefs = { v: 1, hidden: ["email"], shown: [] };
    const defaults = COLUMNS.filter((c) => c.defaultVisible && c.key !== "email").map((c) => c.key);
    expect(keys(p, true)).toEqual(defaults);
  });

  it("never offers cost or margin", () => {
    expect(COLUMNS.map((c) => c.key).join(" ")).not.toMatch(/cost|margin|markup/i);
  });
});

describe("matchesSearch", () => {
  const r = row({ customerName: "Zoë [TEST DATA]", number: 1042, email: "ann@example.com", phone: "(604) 555-0100", city: "Surrey", projectTypes: ["Cabinets"], source: "Nextdoor" });

  it("is accent- and case-insensitive", () => {
    expect(matchesSearch(r, "zoe")).toBe(true);
    expect(matchesSearch(r, "ZOË")).toBe(true);
  });

  it("matches phone digits regardless of formatting", () => {
    expect(matchesSearch(r, "604 555")).toBe(true);
    expect(matchesSearch(r, "604-555-0100")).toBe(true);
    expect(matchesSearch(r, "12")).toBe(false);
  });

  it("matches the lead number with or without #", () => {
    expect(matchesSearch(r, "#1042")).toBe(true);
    expect(matchesSearch(r, "1042")).toBe(true);
    expect(matchesSearch(r, "#9999")).toBe(false);
  });

  it("matches email, city, project type and source; every word must match", () => {
    expect(matchesSearch(r, "ann@example")).toBe(true);
    expect(matchesSearch(r, "surrey")).toBe(true);
    expect(matchesSearch(r, "cabinets surrey")).toBe(true);
    expect(matchesSearch(r, "nextdoor")).toBe(true);
    expect(matchesSearch(r, "surrey burnaby")).toBe(false);
    expect(matchesSearch(r, "   ")).toBe(true);
  });
});

describe("applyFilters", () => {
  const open1 = row({ stage: "new_lead", source: "Referral", channel: "phone", estimatorId: "u1", nextFollowUpAt: "2026-10-21T16:00:00.000Z" });
  const open2 = row({ stage: "contacted", firstViewedAt: "2026-10-02T00:00:00.000Z", nextFollowUpAt: "2026-10-22T16:00:00.000Z" });
  const won = row({ stage: "won", source: "Referral", estimatorId: "u1" });
  const lost = row({ stage: "lost", nextFollowUpAt: "2026-10-01T16:00:00.000Z" });
  const all = [open1, open2, won, lost];
  const ids = (f: Partial<ListFilters>) => applyFilters(all, filters(f), ctx).map((r) => r.id);

  it("filters by status", () => {
    expect(ids({ status: "all" })).toEqual(all.map((r) => r.id));
    expect(ids({ status: "open" })).toEqual([open1.id, open2.id]);
    expect(ids({ status: "won" })).toEqual([won.id]);
    expect(ids({ status: "lost" })).toEqual([lost.id]);
  });

  it("filters by several stages", () => {
    expect(ids({ stages: ["contacted", "lost"] })).toEqual([open2.id, lost.id]);
  });

  it("matches (none) for sources, channels and estimators", () => {
    expect(ids({ sources: [NONE] })).toEqual([open2.id, lost.id]);
    expect(ids({ sources: ["Referral", NONE] })).toEqual(all.map((r) => r.id));
    expect(ids({ channels: ["phone"] })).toEqual([open1.id]);
    expect(ids({ estimators: [NONE] })).toEqual([open2.id, lost.id]);
    expect(ids({ estimators: ["u1"] })).toEqual([open1.id, won.id]);
  });

  it("follow-up due counts open leads only, at a fixed now", () => {
    expect(ids({ dueOnly: true })).toEqual([open1.id]);
  });

  it("not opened yet", () => {
    expect(ids({ unopenedOnly: true })).toEqual([open1.id]);
  });

  it("date range on Vancouver calendar days, both ends inclusive", () => {
    const late = row({ estimateVisitAt: "2026-10-23T06:30:00Z" }); // Oct 22, 11:30 p.m. PDT
    const next = row({ estimateVisitAt: "2026-10-23T07:00:00Z" }); // Oct 23, midnight PDT
    const early = row({ estimateVisitAt: "2026-10-22T07:00:00Z" }); // Oct 22, midnight PDT
    const none = row();
    const f = filters({ dateField: "visit", from: "2026-10-22", to: "2026-10-22" });
    expect(applyFilters([late, next, early, none], f, ctx).map((r) => r.id)).toEqual([late.id, early.id]);
  });

  it("handles the 25-hour day when DST ended (Nov 2 2025)", () => {
    const f = filters({ dateField: "created", from: "2025-11-02", to: "2025-11-02" });
    const at = (iso: string) => row({ createdAt: iso });
    const rows = [at("2025-11-02T06:59:59Z"), at("2025-11-02T07:00:00Z"), at("2025-11-03T07:59:59Z"), at("2025-11-03T08:00:00Z")];
    expect(applyFilters(rows, f, ctx).map((r) => r.createdAt)).toEqual(["2025-11-02T07:00:00Z", "2025-11-03T07:59:59Z"]);
  });

  it("keeps 24-hour days from Nov 1 2026: British Columbia stays on UTC−7", () => {
    const f = filters({ dateField: "created", from: "2026-11-01", to: "2026-11-01" });
    const at = (iso: string) => row({ createdAt: iso });
    const rows = [at("2026-11-01T06:59:59Z"), at("2026-11-01T07:00:00Z"), at("2026-11-02T06:59:59Z"), at("2026-11-02T07:00:00Z")];
    expect(applyFilters(rows, f, ctx).map((r) => r.createdAt)).toEqual(["2026-11-01T07:00:00Z", "2026-11-02T06:59:59Z"]);
  });

  it("combines with search", () => {
    const named = row({ customerName: "Ann Example", stage: "contacted" });
    expect(applyFilters([...all, named], filters({ q: "ann", status: "open" }), ctx)).toEqual([named]);
  });

  it("groupExcluded follows stage and status filters", () => {
    expect(groupExcluded(stage("won"), filters())).toBe(false);
    expect(groupExcluded(stage("won"), filters({ status: "open" }))).toBe(true);
    expect(groupExcluded(stage("contacted"), filters({ stages: ["new_lead"] }))).toBe(true);
    expect(groupExcluded(stage("new_lead"), filters({ stages: ["new_lead"] }))).toBe(false);
  });
});

describe("sortRows", () => {
  it("puts nulls last in both directions", () => {
    const a = row({ nextFollowUpAt: "2026-10-22T16:00:00Z" });
    const b = row({ nextFollowUpAt: null });
    const c = row({ nextFollowUpAt: "2026-10-23T16:00:00Z" });
    expect(sortRows([b, c, a], { col: "followUp", dir: "asc" }, ctx)).toEqual([a, c, b]);
    expect(sortRows([b, a, c], { col: "followUp", dir: "desc" }, ctx)).toEqual([c, a, b]);
  });

  it("breaks ties by time in stage, then number (stable)", () => {
    const a = row({ city: "Surrey", stageChangedAt: "2026-10-10T00:00:00Z" });
    const b = row({ city: "surrey", stageChangedAt: "2026-10-05T00:00:00Z" });
    const c = row({ city: "Surrey", stageChangedAt: "2026-10-05T00:00:00Z" });
    expect(sortRows([a, c, b], { col: "city", dir: "asc" }, ctx)).toEqual([b, c, a]);
    expect(sortRows([a, c, b], { col: "city", dir: "desc" }, ctx)).toEqual([b, c, a]);
  });

  it("default order is longest in stage first", () => {
    const a = row({ stageChangedAt: "2026-10-10T00:00:00Z" });
    const b = row({ stageChangedAt: "2026-10-01T00:00:00Z" });
    expect(sortRows([a, b], undefined, ctx)).toEqual([b, a]);
  });

  it("compares money as Decimal, not text", () => {
    const big = row({ estimatedValue: "10000.00" });
    const small = row({ estimatedValue: "9000.00" });
    const cents = row({ estimatedValue: "1000.10" });
    const less = row({ estimatedValue: "999.99" });
    expect(sortRows([small, big], { col: "value", dir: "desc" }, ctx)).toEqual([big, small]);
    expect(sortRows([cents, less], { col: "value", dir: "asc" }, ctx)).toEqual([less, cents]);
  });

  it("compares text with accents the en-CA way", () => {
    const e = row({ customerName: "Émile" });
    const d = row({ customerName: "Dana" });
    const f = row({ customerName: "frank" });
    expect(sortRows([f, e, d], { col: "name", dir: "asc" }, ctx).map((r) => r.customerName)).toEqual(["Dana", "Émile", "frank"]);
  });

  it("sorts by stage position", () => {
    const w = row({ stage: "won" });
    const n = row({ stage: "new_lead" });
    expect(sortRows([w, n], { col: "stage", dir: "asc" }, ctx)).toEqual([n, w]);
  });
});

describe("groupRows", () => {
  it("orders by stage position and keeps empty groups", () => {
    const shuffled = [STAGES[3], STAGES[0], STAGES[4], STAGES[2], STAGES[1]];
    const groups = groupRows([row({ stage: "contacted" })], shuffled, "stage", { includeMoney: true, ctx });
    expect(groups.map((g) => [g.key, g.count])).toEqual([["new_lead", 0], ["contacted", 1], ["estimate_booked", 0], ["won", 0], ["lost", 0]]);
  });

  it("group=none gives one group in the given order", () => {
    const rows = [row({ stage: "won" }), row()];
    const groups = groupRows(rows, STAGES, "none", { includeMoney: false, ctx });
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toEqual(rows);
    expect(groups[0].stage).toBeNull();
  });

  it("sums exactly with Decimal", () => {
    const rows = [row({ estimatedValue: "0.10" }), row({ estimatedValue: "0.20" }), row()];
    expect(groupRows(rows, STAGES, "stage", { includeMoney: true, ctx })[0].value).toBe("0.30");
    expect(sumValues(rows).toFixed(2)).toBe("0.30");
  });

  it("value is null without money access", () => {
    expect(groupRows([row({ estimatedValue: "5" })], STAGES, "stage", { includeMoney: false, ctx })[0].value).toBeNull();
  });

  it("counts stale rows", () => {
    const stale = row({ stageChangedAt: "2026-10-19T00:00:00Z" });
    const fresh = row({ stageChangedAt: "2026-10-21T18:00:00Z" });
    expect(groupRows([stale, fresh], STAGES, "stage", { includeMoney: false, ctx })[0].stale).toBe(1);
  });
});

describe("rowValue", () => {
  it("prefers a priced estimate total, then the estimated value", () => {
    expect(rowValue(row({ estimateTotal: "8500.00", estimatedValue: "9000" }))).toEqual({ amount: "8500.00", source: "estimate" });
    expect(rowValue(row({ estimateTotal: "0.00", estimatedValue: "9000" }))).toEqual({ amount: "9000", source: "estimated" });
    expect(rowValue(row({ estimatedValue: "9000" }))).toEqual({ amount: "9000", source: "estimated" });
    expect(rowValue(row())).toBeNull();
  });
});

describe("applyPatch", () => {
  it("moves stage, sets follow-up and estimator, for several ids, ignoring unknown ids", () => {
    const a = row({ lostReason: "Price", stage: "lost" });
    const b = row();
    const at = "2026-10-21T20:00:00.000Z";
    const moved = applyPatch([a, b], { type: "stage", ids: [a.id, b.id, "nope"], stage: stage("contacted"), at });
    expect(moved.map((r) => [r.stageId, r.stageKey, r.stageKind, r.stageChangedAt, r.closedAt, r.lostReason])).toEqual([
      ["s-contacted", "contacted", "open", at, null, null],
      ["s-contacted", "contacted", "open", at, null, null],
    ]);
    const lost = applyPatch([b], { type: "stage", ids: [b.id], stage: stage("lost"), at, lostReason: "No response" })[0];
    expect([lost.stageKind, lost.closedAt, lost.lostReason]).toEqual(["lost", at, "No response"]);
    expect(applyPatch([a], { type: "followUp", ids: [a.id], at })[0].nextFollowUpAt).toBe(at);
    expect(applyPatch([a], { type: "followUp", ids: [a.id], at: null })[0].nextFollowUpAt).toBeNull();
    const est = applyPatch([a, b], { type: "estimator", ids: [b.id], estimatorId: "u9", estimatorName: "Estimator" });
    expect(est[0]).toBe(a);
    expect([est[1].estimatorId, est[1].estimatorName]).toEqual(["u9", "Estimator"]);
  });

  it("leaves a row in the same stage untouched", () => {
    const a = row({ stage: "contacted" });
    expect(applyPatch([a], { type: "stage", ids: [a.id], stage: stage("contacted"), at: "x" })[0]).toBe(a);
  });
});

describe("days, staleness and follow-ups", () => {
  it("agree with the board for every stage kind", () => {
    const r = row({ stage: "contacted", stageChangedAt: "2026-10-18T18:00:00Z" });
    expect(daysInStage(r, NOW)).toBe(3);
    expect(isStale(r, stage("contacted"), NOW)).toBe(true);
    expect(isStale({ ...r, stageChangedAt: "2026-10-18T20:00:00Z" }, stage("contacted"), NOW)).toBe(false);
    expect(isStale(row({ stage: "estimate_booked", stageChangedAt: "2025-01-01T00:00:00Z" }), stage("estimate_booked"), NOW)).toBe(false);
    for (const k of ["won", "lost"]) expect(isStale(row({ stage: k, stageChangedAt: "2025-01-01T00:00:00Z" }), { ...stage(k), staleAfterDays: 1 }, NOW)).toBe(false);
    expect(daysInStage(row({ stageChangedAt: "2026-10-22T00:00:00Z" }), NOW)).toBe(0);
  });

  it("follow-up is due from its time, for open leads only", () => {
    expect(isFollowUpDue({ stageKind: "open", nextFollowUpAt: NOW.toISOString() }, NOW)).toBe(true);
    expect(isFollowUpDue({ stageKind: "open", nextFollowUpAt: "2026-10-21T19:00:01Z" }, NOW)).toBe(false);
    expect(isFollowUpDue({ stageKind: "won", nextFollowUpAt: "2026-10-01T00:00:00Z" }, NOW)).toBe(false);
    expect(isFollowUpDue({ stageKind: "open", nextFollowUpAt: null }, NOW)).toBe(false);
  });

  it("follow-ups are due at 9 a.m. Vancouver time", () => {
    expect(followUpInstant("2026-10-23").toISOString()).toBe("2026-10-23T16:00:00.000Z");
    expect(followUpInstant("2025-11-03").toISOString()).toBe("2025-11-03T17:00:00.000Z");
    // UTC−7 all year from Nov 2026.
    expect(followUpInstant("2026-11-02").toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });
});

describe("telHref and mailtoHref", () => {
  it("normalises phone numbers to digits", () => {
    expect(telHref("604-555-0100")).toBe("tel:+16045550100");
    expect(telHref("+1 (604) 555-0100")).toBe("tel:+16045550100");
    expect(telHref("1-604-555-0100")).toBe("tel:+16045550100");
    expect(telHref("604-555-0100 ext. 12")).toBe("tel:+16045550100");
    expect(telHref("555-0100")).toBe("tel:5550100");
    expect(telHref("")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref("call me")).toBeNull();
    expect(telHref("javascript:alert(1)")).toBeNull();
  });

  it("links only plain addresses", () => {
    expect(mailtoHref("ann@example.com")).toBe("mailto:ann@example.com");
    expect(mailtoHref("javascript:alert(1)")).toBeNull();
    expect(mailtoHref("a b@example.com")).toBeNull();
    expect(mailtoHref("x@example.com\nbcc:y@example.com")).toBeNull();
    expect(mailtoHref("x@example.com?bcc=y@example.com")).toBeNull();
    expect(mailtoHref(null)).toBeNull();
  });
});

describe("registry", () => {
  it("channel labels cover every lead channel", () => {
    expect(Object.keys(CHANNEL_LABELS).sort()).toEqual([...LEAD_CHANNELS].sort());
  });

  it("bulk limit matches the spec", () => {
    expect(BULK_LIMIT).toBe(200);
  });
});

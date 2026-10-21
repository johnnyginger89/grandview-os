/**
 * Leads list and board: the single source of truth for row types, the column
 * registry, URL and cookie parsing, search, filters, sorting, grouping and totals.
 * Pure: runs in the browser and on the server.
 */
import { z } from "zod";
import { addDays, businessDate, isIsoDate, isoToInstant } from "@/lib/calendar-date";
import { Decimal } from "@/lib/money";

export { businessDate };

export const VIEW_MODES = ["board", "list"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export const CLOSED_WINDOWS = ["30d", "90d", "365d", "all"] as const;
export type ClosedWindow = (typeof CLOSED_WINDOWS)[number];
export const STATUS_FILTERS = ["all", "open", "won", "lost"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const DATE_FIELDS = ["created", "visit", "followUp", "activity", "closed"] as const;
export type DateField = (typeof DATE_FIELDS)[number];
export const GROUP_BYS = ["stage", "none"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

/** Filter token for "(none)" / "Unassigned". */
export const NONE = "__none";
export const LIST_ROW_LIMIT = 1000;
export const GROUP_RENDER_LIMIT = 100;
export const BULK_LIMIT = 200;
/** Vancouver wall clock a follow-up date is due at. */
export const FOLLOW_UP_TIME = "09:00";
export const LIST_PREFS_COOKIE = "gv_leads_view";
const PREFS_MAX_CHARS = 1500;
const DAY_MS = 86_400_000;
const STAGE_KEY_RE = /^[a-z0-9_]{1,50}$/;

export const CLOSED_WINDOW_LABELS: Record<ClosedWindow, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "365d": "Last 12 months",
  all: "All time",
};

export function closedWindowDays(w: ClosedWindow): number | null {
  return { "30d": 30, "90d": 90, "365d": 365, all: null }[w];
}

export const DATE_FIELD_LABELS: Record<DateField, string> = {
  created: "Created",
  visit: "Estimate visit",
  followUp: "Next follow-up",
  activity: "Last activity",
  closed: "Won/lost date",
};

/** Same keys as LEAD_CHANNELS in the schema (kept here so the browser bundle doesn't pull in Drizzle). */
export const CHANNEL_LABELS: Record<string, string> = {
  youcanbookme: "YouCanBook.me",
  website_form: "Website form",
  phone: "Phone",
  email: "Email",
  facebook: "Facebook",
  instagram: "Instagram",
  referral: "Referral",
  other: "Other",
};

export function channelName(c: string | null | undefined): string | null {
  return c ? (CHANNEL_LABELS[c] ?? c) : null;
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  detached: "Detached house",
  townhouse: "Townhouse",
  condo: "Condo / apartment",
  strata_complex: "Strata complex",
  commercial: "Commercial",
  other: "Other",
};

export function propertyTypeName(p: string | null | undefined): string | null {
  return p ? (PROPERTY_TYPE_LABELS[p] ?? p) : null;
}

export const COLUMN_KEYS = [
  "name", "estimator", "stage", "daysInStage", "followUp", "visit", "projectTypes", "value", "closed",
  "city", "address", "source", "created", "email", "phone", "channel", "lastActivity", "lastContacted", "lostReason",
  "timeline", "propertyType", "contact", "estimateStatus",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];
export type SortKey = Exclude<ColumnKey, "email" | "phone">;
export const SORT_KEYS = COLUMN_KEYS.filter((k): k is SortKey => k !== "email" && k !== "phone");

/** Everything the browser receives per lead. Money fields are null unless the server included them. */
export interface PipelineRow {
  id: string;
  number: number | null;
  title: string;
  customerId: string;
  customerName: string;
  customerType: "residential" | "commercial" | "strata";
  stageId: string;
  stageKey: string;
  stageKind: "open" | "won" | "lost";
  stageChangedAt: string;
  createdAt: string;
  closedAt: string | null;
  estimateVisitAt: string | null;
  firstViewedAt: string | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  lastActivityAt: string | null;
  projectTypes: string[];
  source: string | null;
  channel: string | null;
  timeline: string | null;
  lostReason: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  unit: string | null;
  city: string | null;
  propertyType: string | null;
  estimatorId: string | null;
  estimatorName: string | null;
  // money (estimates.read only)
  estimatedValue: string | null;
  estimateId: string | null;
  estimateTotal: string | null;
  estimateStatus: string | null;
}

export interface StageInfo {
  id: string;
  key: string;
  name: string;
  kind: "open" | "won" | "lost";
  color: string;
  position: number;
  staleAfterDays: number | null;
}

export interface ListFilters {
  q: string;
  status: StatusFilter;
  stages: string[];
  sources: string[];
  channels: string[];
  estimators: string[];
  dateField: DateField;
  from: string | null;
  to: string | null;
  dueOnly: boolean;
  unopenedOnly: boolean;
}

export interface ListSort {
  col: SortKey;
  dir: "asc" | "desc";
}

export interface ListState {
  view?: ViewMode;
  closed: ClosedWindow;
  filters: ListFilters;
  sort?: ListSort;
  group?: GroupBy;
}

export interface ListPrefs {
  v: 1;
  view?: ViewMode;
  /** Overrides of `defaultVisible`, so a column added later still shows by default. */
  hidden: ColumnKey[];
  shown: ColumnKey[];
  /** Stage keys. Undefined means the default: won and lost collapsed. */
  collapsed?: string[];
  sort?: ListSort;
  group?: GroupBy;
}

export interface Ctx {
  now: Date;
  stagesById: Map<string, StageInfo>;
}

export type SortValue = string | number | Decimal | null;

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  hideable: boolean;
  sortable: boolean;
  money?: boolean;
  align?: "right";
  widthPx: number;
  sortValue?: (r: PipelineRow, ctx: Ctx) => SortValue;
}

export const DEFAULT_FILTERS: ListFilters = {
  q: "",
  status: "all",
  stages: [],
  sources: [],
  channels: [],
  estimators: [],
  dateField: "created",
  from: null,
  to: null,
  dueOnly: false,
  unopenedOnly: false,
};

export function defaultPrefs(): ListPrefs {
  return { v: 1, hidden: [], shown: [] };
}

const epoch = (v: string | null) => (v ? Date.parse(v) : null);

type ColumnInit = Omit<ColumnDef, "defaultVisible" | "hideable" | "sortable"> & Partial<Pick<ColumnDef, "defaultVisible" | "hideable" | "sortable">>;
const col = (c: ColumnInit): ColumnDef => ({ defaultVisible: true, hideable: true, sortable: !!c.sortValue, ...c });

/** In default order: the monday.com Deals board order for shared columns. */
export const COLUMNS: readonly ColumnDef[] = [
  col({ key: "name", label: "Lead", hideable: false, widthPx: 240, sortValue: (r) => r.customerName }),
  col({ key: "estimator", label: "Estimator", widthPx: 150, sortValue: (r) => r.estimatorName }),
  col({ key: "stage", label: "Stage", hideable: false, widthPx: 190, sortValue: (r, ctx) => ctx.stagesById.get(r.stageId)?.position ?? null }),
  col({ key: "daysInStage", label: "Days", widthPx: 80, sortValue: (r, ctx) => daysInStage(r, ctx.now) }),
  col({ key: "followUp", label: "Next follow-up", widthPx: 140, sortValue: (r) => epoch(r.nextFollowUpAt) }),
  col({ key: "visit", label: "Estimate visit", widthPx: 190, sortValue: (r) => epoch(r.estimateVisitAt) }),
  col({ key: "projectTypes", label: "Project type", widthPx: 190, sortValue: (r) => r.projectTypes[0] ?? null }),
  col({ key: "value", label: "Value", money: true, align: "right", widthPx: 120, sortValue: (r) => { const v = rowValue(r); return v ? new Decimal(v.amount) : null; } }),
  col({ key: "closed", label: "Won/lost date", defaultVisible: false, widthPx: 120, sortValue: (r) => epoch(r.closedAt) }),
  col({ key: "city", label: "City", widthPx: 130, sortValue: (r) => r.city }),
  col({ key: "address", label: "Address", defaultVisible: false, widthPx: 220, sortValue: (r) => r.street }),
  col({ key: "source", label: "Lead source", widthPx: 150, sortValue: (r) => r.source }),
  col({ key: "created", label: "Created", widthPx: 110, sortValue: (r) => epoch(r.createdAt) }),
  col({ key: "email", label: "Email", widthPx: 220 }),
  col({ key: "phone", label: "Phone", widthPx: 140 }),
  col({ key: "channel", label: "Channel", defaultVisible: false, widthPx: 130, sortValue: (r) => channelName(r.channel) }),
  col({ key: "lastActivity", label: "Last activity", widthPx: 120, sortValue: (r) => epoch(r.lastActivityAt) }),
  col({ key: "lastContacted", label: "Last contacted", defaultVisible: false, widthPx: 120, sortValue: (r) => epoch(r.lastContactedAt) }),
  col({ key: "lostReason", label: "Lost reason", defaultVisible: false, widthPx: 170, sortValue: (r) => r.lostReason }),
  col({ key: "timeline", label: "Timeline", defaultVisible: false, widthPx: 140, sortValue: (r) => r.timeline }),
  col({ key: "propertyType", label: "Property type", defaultVisible: false, widthPx: 150, sortValue: (r) => propertyTypeName(r.propertyType) }),
  col({ key: "contact", label: "Contact", defaultVisible: false, widthPx: 160, sortValue: (r) => r.contactName }),
  col({ key: "estimateStatus", label: "Estimate", money: true, defaultVisible: false, widthPx: 110, sortValue: (r) => r.estimateStatus }),
];

const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));
export const columnDef = (key: ColumnKey) => COLUMN_BY_KEY.get(key)!;
const isColumnKey = (v: unknown): v is ColumnKey => typeof v === "string" && COLUMN_BY_KEY.has(v as ColumnKey);

// ---------------------------------------------------------------------------
// URL parameters
// ---------------------------------------------------------------------------

type SearchParamsRecord = Record<string, string | string[] | undefined>;

const isoDay = z
  .string()
  .refine((d) => isIsoDate(d) && d >= "2000-01-01" && d <= "2100-12-31")
  .nullable()
  .catch(null);

/** Repeated params always work; comma lists only for tokens that can't contain commas (owner-named sources can). */
const tokens = (opts: { split: boolean; pattern?: RegExp }) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .catch(undefined)
    .transform((v) => {
      const raw = v === undefined ? [] : Array.isArray(v) ? v : [v];
      const parts = (opts.split ? raw.flatMap((s) => s.split(",")) : raw).map((s) => s.trim());
      const ok = parts.filter((s) => s.length > 0 && s.length <= 100 && (!opts.pattern || opts.pattern.test(s)));
      return [...new Set(ok)].slice(0, 50);
    });

const flag = z.string().optional().catch(undefined).transform((v) => v === "1" || v === "true");

const paramsSchema = z.object({
  view: z.enum(VIEW_MODES).optional().catch(undefined),
  closed: z.enum(CLOSED_WINDOWS).catch("30d"),
  q: z.string().catch("").transform((s) => s.trim().slice(0, 100)),
  status: z.enum(STATUS_FILTERS).catch("all"),
  stage: tokens({ split: true, pattern: STAGE_KEY_RE }),
  source: tokens({ split: false }),
  channel: tokens({ split: true }),
  estimator: tokens({ split: true }),
  df: z.enum(DATE_FIELDS).catch("created"),
  from: isoDay,
  to: isoDay,
  due: flag,
  unopened: flag,
  sort: z.enum(SORT_KEYS as [SortKey, ...SortKey[]]).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  group: z.enum(GROUP_BYS).optional().catch(undefined),
});

const ARRAY_PARAMS = new Set(["stage", "source", "channel", "estimator"]);

export function parseListParams(sp: SearchParamsRecord): ListState {
  const input: Record<string, string | string[] | undefined> = {};
  for (const k of Object.keys(paramsSchema.shape)) {
    const v = sp[k];
    input[k] = ARRAY_PARAMS.has(k) ? v : Array.isArray(v) ? v[0] : v;
  }
  const p = paramsSchema.parse(input);
  let { from, to } = p;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    view: p.view,
    closed: p.closed,
    filters: {
      q: p.q,
      status: p.status,
      stages: p.stage,
      sources: p.source,
      channels: p.channel,
      estimators: p.estimator,
      dateField: p.df,
      from,
      to,
      dueOnly: p.due,
      unopenedOnly: p.unopened,
    },
    sort: p.sort ? { col: p.sort, dir: p.dir } : undefined,
    group: p.group,
  };
}

/** Omits defaults, in a stable key order. */
export function toSearchParams(s: ListState): URLSearchParams {
  const out = new URLSearchParams();
  const f = s.filters;
  if (s.view) out.set("view", s.view);
  if (s.closed !== "30d") out.set("closed", s.closed);
  if (f.q.trim()) out.set("q", f.q.trim().slice(0, 100));
  if (f.status !== "all") out.set("status", f.status);
  for (const v of f.stages) out.append("stage", v);
  for (const v of f.sources) out.append("source", v);
  for (const v of f.channels) out.append("channel", v);
  for (const v of f.estimators) out.append("estimator", v);
  if ((f.from || f.to) && f.dateField !== "created") out.set("df", f.dateField);
  if (f.from) out.set("from", f.from);
  if (f.to) out.set("to", f.to);
  if (f.dueOnly) out.set("due", "1");
  if (f.unopenedOnly) out.set("unopened", "1");
  if (s.sort) {
    out.set("sort", s.sort.col);
    if (s.sort.dir === "desc") out.set("dir", "desc");
  }
  if (s.group) out.set("group", s.group);
  return out;
}

// ---------------------------------------------------------------------------
// Preferences cookie (base64url JSON, written by the browser)
// ---------------------------------------------------------------------------

const keyList = (keep: (c: ColumnDef) => boolean) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((a) => [...new Set(a.filter(isColumnKey))].filter((k) => keep(columnDef(k))));

const prefsSchema = z.object({
  v: z.literal(1),
  view: z.enum(VIEW_MODES).optional().catch(undefined),
  hidden: keyList((c) => c.hideable && c.defaultVisible),
  shown: keyList((c) => c.hideable && !c.defaultVisible),
  collapsed: z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((a) => (a ? [...new Set(a.filter((s): s is string => typeof s === "string" && STAGE_KEY_RE.test(s)))].slice(0, 50) : undefined)),
  sort: z.object({ col: z.enum(SORT_KEYS as [SortKey, ...SortKey[]]), dir: z.enum(["asc", "desc"]) }).optional().catch(undefined),
  group: z.enum(GROUP_BYS).optional().catch(undefined),
});

function toBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

/** Never throws: any problem gives the defaults. */
export function decodeListPrefs(raw: string | undefined | null): ListPrefs {
  if (!raw || raw.length > PREFS_MAX_CHARS) return defaultPrefs();
  try {
    const r = prefsSchema.safeParse(JSON.parse(fromBase64Url(raw)));
    if (!r.success) return defaultPrefs();
    const p: ListPrefs = { v: 1, hidden: r.data.hidden, shown: r.data.shown };
    if (r.data.view) p.view = r.data.view;
    if (r.data.collapsed) p.collapsed = r.data.collapsed;
    if (r.data.sort) p.sort = r.data.sort;
    if (r.data.group) p.group = r.data.group;
    return p;
  } catch {
    return defaultPrefs();
  }
}

export function encodeListPrefs(p: ListPrefs): string {
  const clean = prefsSchema.parse(p);
  const json = JSON.stringify(clean);
  const out = toBase64Url(json);
  if (out.length >= PREFS_MAX_CHARS) throw new Error("List preferences are too large to save.");
  return out;
}

/** Hide or show a column, keeping only overrides of its default. */
export function setColumnVisible(p: ListPrefs, key: ColumnKey, visible: boolean): ListPrefs {
  const c = columnDef(key);
  if (!c.hideable) return p;
  const hidden = p.hidden.filter((k) => k !== key);
  const shown = p.shown.filter((k) => k !== key);
  if (c.defaultVisible && !visible) hidden.push(key);
  if (!c.defaultVisible && visible) shown.push(key);
  return { ...p, hidden, shown };
}

export function visibleColumns(p: ListPrefs, o: { includeMoney: boolean }): ColumnDef[] {
  return COLUMNS.filter((c) => {
    if (c.money && !o.includeMoney) return false;
    if (!c.hideable) return true;
    return c.defaultVisible ? !p.hidden.includes(c.key) : p.shown.includes(c.key);
  });
}

// ---------------------------------------------------------------------------
// Search, filters, sorting, grouping
// ---------------------------------------------------------------------------

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const PHONE_LIKE = /^[\d\s()+.#-]+$/;

export function matchesSearch(r: PipelineRow, q: string): boolean {
  const query = fold(q).trim();
  if (!query) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 3 && PHONE_LIKE.test(query) && r.phone && r.phone.replace(/\D/g, "").includes(digits)) return true;
  const hay = fold(
    [r.customerName, r.contactName, r.number != null ? `#${r.number}` : null, r.email, r.city, r.street, r.source, ...r.projectTypes]
      .filter(Boolean)
      .join("\n"),
  );
  return query.split(/\s+/).every((t) => hay.includes(t));
}

function dateFieldValue(r: PipelineRow, f: DateField): number | null {
  const v = { created: r.createdAt, visit: r.estimateVisitAt, followUp: r.nextFollowUpAt, activity: r.lastActivityAt, closed: r.closedAt }[f];
  return epoch(v);
}

/** Vancouver calendar days, both ends inclusive, as half-open epoch bounds. */
export function dateRangeBounds(from: string | null, to: string | null): { start: number; end: number } | null {
  if (!from && !to) return null;
  return {
    start: from ? isoToInstant(from).getTime() : -Infinity,
    end: to ? isoToInstant(addDays(to, 1)).getTime() : Infinity,
  };
}

export function isUnopened(r: PipelineRow): boolean {
  return !r.firstViewedAt && r.stageKind === "open";
}

export function applyFilters(rows: PipelineRow[], f: ListFilters, ctx: Ctx): PipelineRow[] {
  const set = (a: string[]) => (a.length ? new Set(a) : null);
  const stages = set(f.stages);
  const sources = set(f.sources);
  const channels = set(f.channels);
  const estimators = set(f.estimators);
  const range = dateRangeBounds(f.from, f.to);
  return rows.filter((r) => {
    if (f.status !== "all" && r.stageKind !== f.status) return false;
    if (stages && !stages.has(r.stageKey)) return false;
    if (sources && !sources.has(r.source || NONE)) return false;
    if (channels && !channels.has(r.channel || NONE)) return false;
    if (estimators && !estimators.has(r.estimatorId || NONE)) return false;
    if (f.dueOnly && !isFollowUpDue(r, ctx.now)) return false;
    if (f.unopenedOnly && !isUnopened(r)) return false;
    if (range) {
      const v = dateFieldValue(r, f.dateField);
      if (v == null || v < range.start || v >= range.end) return false;
    }
    return matchesSearch(r, f.q);
  });
}

/** How many kinds of filter are active (search and status have their own controls). */
export function activeFilterCount(f: ListFilters): number {
  return [f.stages.length, f.sources.length, f.channels.length, f.estimators.length, f.from || f.to, f.dueOnly, f.unopenedOnly].filter(Boolean).length;
}

export function hasAnyFilter(f: ListFilters): boolean {
  return activeFilterCount(f) > 0 || !!f.q.trim() || f.status !== "all";
}

/** A stage's group is left out when a stage or status filter excludes it. */
export function groupExcluded(stage: StageInfo, f: ListFilters): boolean {
  if (f.stages.length && !f.stages.includes(stage.key)) return true;
  return f.status !== "all" && stage.kind !== f.status;
}

const collator = new Intl.Collator("en-CA", { sensitivity: "base", numeric: true });

function compareValues(a: Exclude<SortValue, null>, b: Exclude<SortValue, null>): number {
  if (Decimal.isDecimal(a) && Decimal.isDecimal(b)) return a.cmp(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

function defaultOrder(a: PipelineRow, b: PipelineRow): number {
  return Date.parse(a.stageChangedAt) - Date.parse(b.stageChangedAt) || (a.number ?? 0) - (b.number ?? 0);
}

/** Stable; nulls last in both directions; ties by time in stage, then lead number. */
export function sortRows(rows: PipelineRow[], s: ListSort | undefined, ctx: Ctx): PipelineRow[] {
  const sortValue = s ? COLUMN_BY_KEY.get(s.col)?.sortValue : undefined;
  if (!s || !sortValue) return [...rows].sort(defaultOrder);
  const sign = s.dir === "desc" ? -1 : 1;
  const keyed = rows.map((r) => {
    const v = sortValue(r, ctx);
    return { r, v: v === "" || (typeof v === "number" && Number.isNaN(v)) ? null : v };
  });
  keyed.sort((x, y) => {
    if (x.v == null || y.v == null) return x.v == null && y.v == null ? defaultOrder(x.r, y.r) : x.v == null ? 1 : -1;
    return sign * compareValues(x.v, y.v) || defaultOrder(x.r, y.r);
  });
  return keyed.map((k) => k.r);
}

export interface Group {
  key: string;
  stage: StageInfo | null;
  rows: PipelineRow[];
  count: number;
  /** Decimal string, or null when money is hidden. */
  value: string | null;
  stale: number;
}

export function groupRows(rows: PipelineRow[], stages: StageInfo[], by: GroupBy, o: { includeMoney: boolean; ctx: Ctx }): Group[] {
  const make = (key: string, stage: StageInfo | null, list: PipelineRow[]): Group => ({
    key,
    stage,
    rows: list,
    count: list.length,
    value: o.includeMoney ? sumValues(list).toFixed(2) : null,
    stale: list.filter((r) => isStale(r, o.ctx.stagesById.get(r.stageId), o.ctx.now)).length,
  });
  if (by === "none") return [make("all", null, rows)];
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const buckets = new Map(ordered.map((s) => [s.id, [] as PipelineRow[]]));
  for (const r of rows) buckets.get(r.stageId)?.push(r);
  return ordered.map((s) => make(s.key, s, buckets.get(s.id)!));
}

/** The estimate total when there is a priced estimate, otherwise the lead's estimated value. Before GST. */
export function rowValue(r: PipelineRow): { amount: string; source: "estimate" | "estimated" } | null {
  if (r.estimateTotal != null && !new Decimal(r.estimateTotal).isZero()) return { amount: r.estimateTotal, source: "estimate" };
  if (r.estimatedValue != null) return { amount: r.estimatedValue, source: "estimated" };
  return null;
}

export function sumValues(rows: PipelineRow[]): Decimal {
  return rows.reduce((sum, r) => {
    const v = rowValue(r);
    return v ? sum.plus(v.amount) : sum;
  }, new Decimal(0));
}

export function daysInStage(r: Pick<PipelineRow, "stageChangedAt">, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(r.stageChangedAt)) / DAY_MS));
}

/** Same rule as the board card: open stages with a stale limit. Won and lost are never stale. */
export function isStale(r: Pick<PipelineRow, "stageKind" | "stageChangedAt">, stage: Pick<StageInfo, "staleAfterDays"> | undefined, now: Date): boolean {
  return !!stage && stage.staleAfterDays != null && r.stageKind === "open" && daysInStage(r, now) >= stage.staleAfterDays;
}

export function isFollowUpDue(r: Pick<PipelineRow, "stageKind" | "nextFollowUpAt">, now: Date): boolean {
  return r.stageKind === "open" && !!r.nextFollowUpAt && Date.parse(r.nextFollowUpAt) <= now.getTime();
}

/** The instant a follow-up on that Vancouver calendar day is due. */
export function followUpInstant(date: string): Date {
  return isoToInstant(date, FOLLOW_UP_TIME);
}

/** "604-555-0100" → "tel:+16045550100". Only digits and a leading + ever reach the href. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const main = phone.split(/\s*(?:ext\.?|extension|x|#)\s*\d*\s*$/i)[0];
  const digits = main.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  if (main.trim().startsWith("+")) return `tel:+${digits}`;
  return `tel:${digits}`;
}

const EMAIL_RE = /^[^\s@<>()"',;:?&%/\\[\]]+@[^\s@<>()"',;:?&%/\\[\]]+\.[a-z]{2,}$/i;

/** Only plain addresses become links; anything odd shows as text. */
export function mailtoHref(email: string | null): string | null {
  if (!email) return null;
  const e = email.trim();
  return e.length <= 254 && EMAIL_RE.test(e) ? `mailto:${e}` : null;
}

export type RowPatch =
  | { type: "stage"; ids: string[]; stage: StageInfo; at: string; lostReason?: string | null }
  | { type: "followUp"; ids: string[]; at: string | null }
  | { type: "estimator"; ids: string[]; estimatorId: string | null; estimatorName: string | null };

/** The useOptimistic reducer. */
export function applyPatch(rows: PipelineRow[], p: RowPatch): PipelineRow[] {
  const ids = new Set(p.ids);
  return rows.map((r) => {
    if (!ids.has(r.id)) return r;
    switch (p.type) {
      case "stage":
        if (r.stageId === p.stage.id) return r;
        return {
          ...r,
          stageId: p.stage.id,
          stageKey: p.stage.key,
          stageKind: p.stage.kind,
          stageChangedAt: p.at,
          closedAt: p.stage.kind === "open" ? null : p.at,
          lostReason: p.stage.kind === "lost" ? (p.lostReason ?? r.lostReason) : null,
        };
      case "followUp":
        return { ...r, nextFollowUpAt: p.at };
      case "estimator":
        return { ...r, estimatorId: p.estimatorId, estimatorName: p.estimatorName };
    }
  });
}

/**
 * Reporting periods on Vancouver calendar days. Pure: no DB, no server-only, so
 * the period picker can import the presets and labels.
 *
 * A range covers whole local days [from, toInclusive]. Its instants are
 * [local midnight of `from`, local midnight after `toInclusive`), so an
 * in-progress range ends at the start of tomorrow and includes all of today.
 */
import { addDays, daysInMonth, diffDays, formatIsoDate, isIsoDate, isoToInstant, parseIso, todayIso, toIso, type IsoDate } from "@/lib/calendar-date";

export const PERIOD_PRESETS = ["this_month", "last_month", "qtd", "ytd", "l12m", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const COMPARE_MODES = ["prior", "ly"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  qtd: "Quarter to date",
  ytd: "Year to date",
  l12m: "Last 12 months",
  custom: "Custom…",
};
export const COMPARE_LABELS: Record<CompareMode, string> = {
  prior: "vs previous period",
  ly: "vs same period last year",
};

/** Presets whose previous period is last year, so the compare choice is fixed. */
export const FORCED_LY: readonly PeriodPreset[] = ["ytd", "l12m"];

export const EARLIEST_CUSTOM_DATE: IsoDate = "2015-01-01";
export const MAX_CUSTOM_MONTHS = 36;

/** The URL for a period choice; defaults are left out so links stay short. */
export function performanceHref(q: { period: string; compare?: string; from?: string; to?: string }): string {
  const sp = new URLSearchParams({ period: q.period });
  if (q.compare && q.compare !== "prior") sp.set("compare", q.compare);
  if (q.period === "custom") {
    if (q.from) sp.set("from", q.from);
    if (q.to) sp.set("to", q.to);
  }
  return `/performance?${sp.toString()}`;
}

export interface DayRange {
  from: IsoDate;
  toInclusive: IsoDate;
}
export interface Range extends DayRange {
  start: Date;
  end: Date;
  label: string;
}
export interface ResolvedPeriod {
  preset: PeriodPreset;
  /** Effective mode: forced to "ly" for ytd and l12m. */
  compare: CompareMode;
  today: IsoDate;
  current: Range;
  /** The whole period the current range belongs to (all of October for "this month"); goals are measured against it. */
  full: DayRange;
  comparison: Range;
  lastYear: Range;
  /** min(current.end, now): the instant backlog is measured at. */
  asOf: Date;
  inProgress: boolean;
  /** Local days elapsed ÷ days in the full period, while in progress. */
  elapsedFraction: number | null;
  /** Fiscal year (the calendar year it starts in) containing the last day of the range. */
  fiscalYear: number;
  fiscalYearStartMonth: number;
  /** 12 × "YYYY-MM", ending with the month of current.toInclusive. */
  chartMonths: string[];
  chartWindow: { start: Date; end: Date };
}

export type PeriodInput = { preset: PeriodPreset; compare: CompareMode; from?: string; to?: string };
export type PeriodResult = { ok: true; period: ResolvedPeriod } | { ok: false; error: string; period: ResolvedPeriod };

export const monthStart = (s: IsoDate): IsoDate => `${s.slice(0, 7)}-01`;
export const monthKey = (s: IsoDate): string => s.slice(0, 7);

export function monthEnd(s: IsoDate): IsoDate {
  const { y, m } = parseIso(s);
  return toIso({ y, m, d: daysInMonth(y, m) });
}

/** Calendar months later (or earlier), clamping the day: Mar 31 − 1 month → Feb 28/29. */
export function addMonthsClamped(s: IsoDate, n: number): IsoDate {
  const { y, m, d } = parseIso(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toIso({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

const isWholeMonths = (r: DayRange) => r.from.endsWith("-01") && r.toInclusive === monthEnd(r.toInclusive);
const minIso = (a: IsoDate, b: IsoDate) => (a < b ? a : b);
const maxIso = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

/** Move a range by whole months; whole-month ranges stay whole (Feb 2029 → all of Feb 2028). */
export function shiftMonths(r: DayRange, n: number): DayRange {
  const from = addMonthsClamped(r.from, n);
  const toInclusive = isWholeMonths(r) ? monthEnd(addMonthsClamped(monthStart(r.toInclusive), n)) : addMonthsClamped(r.toInclusive, n);
  return { from, toInclusive };
}

/** Each "YYYY-MM-01" a range touches, in order. */
export function monthsIn(r: DayRange): IsoDate[] {
  const out: IsoDate[] = [];
  for (let m = monthStart(r.from); m <= r.toInclusive; m = addMonthsClamped(m, 1)) out.push(m);
  return out;
}

/** Local days in both ranges (0 when they don't meet). */
export function overlapDays(a: DayRange, b: DayRange): number {
  const from = maxIso(a.from, b.from);
  const to = minIso(a.toInclusive, b.toInclusive);
  return from > to ? 0 : diffDays(from, to) + 1;
}

export function dayCount(r: DayRange): number {
  return diffDays(r.from, r.toInclusive) + 1;
}

/** The calendar year in which the fiscal year containing `s` starts. */
export function fiscalYearOf(s: IsoDate, fiscalYearStartMonth: number): number {
  const { y, m } = parseIso(s);
  return m >= fiscalYearStartMonth ? y : y - 1;
}

const short = (s: IsoDate) => formatIsoDate(s, { month: "short", day: "numeric" });
const year = (s: IsoDate) => Number(s.slice(0, 4));

/** "Oct 1–20", "Jul 1 – Oct 20", "Nov 1, 2025 – Oct 20, 2026". The year shows when it isn't `refYear`. */
export function rangeLabel(r: DayRange, refYear: number): string {
  const { from, toInclusive: to } = r;
  const tail = year(to) === refYear ? "" : `, ${year(to)}`;
  if (from === to) return `${short(from)}${tail}`;
  if (year(from) !== year(to)) return `${short(from)}, ${year(from)} – ${short(to)}, ${year(to)}`;
  if (monthKey(from) === monthKey(to)) return `${short(from)}–${parseIso(to).d}${tail}`;
  return `${short(from)} – ${short(to)}${tail}`;
}

export function toRange(r: DayRange, refYear: number): Range {
  return { ...r, start: isoToInstant(r.from), end: isoToInstant(addDays(r.toInclusive, 1)), label: rangeLabel(r, refYear) };
}

/** The last-12-months window ending today: 11 full months plus this month to date. */
export function trailing12(today: IsoDate): DayRange {
  return { from: addMonthsClamped(monthStart(today), -11), toInclusive: today };
}

function quarterStart(today: IsoDate, fsm: number): IsoDate {
  const { y, m } = parseIso(today);
  const sinceFy = (m - fsm + 12) % 12;
  const qm = ((fsm - 1 + Math.floor(sinceFy / 3) * 3) % 12) + 1;
  return toIso({ y: qm > m ? y - 1 : y, m: qm, d: 1 });
}

interface PresetDays {
  current: DayRange;
  full: DayRange;
  prior: DayRange;
}

function presetDays(preset: Exclude<PeriodPreset, "custom">, today: IsoDate, fsm: number): PresetDays {
  switch (preset) {
    case "this_month": {
      const current = { from: monthStart(today), toInclusive: today };
      return { current, full: { from: current.from, toInclusive: monthEnd(today) }, prior: shiftMonths(current, -1) };
    }
    case "last_month": {
      const from = addMonthsClamped(monthStart(today), -1);
      const current = { from, toInclusive: monthEnd(from) };
      return { current, full: current, prior: shiftMonths(current, -1) };
    }
    case "qtd": {
      const from = quarterStart(today, fsm);
      const current = { from, toInclusive: today };
      const priorFrom = addMonthsClamped(from, -3);
      // Same number of elapsed days into the previous quarter, never past its end.
      const prior = { from: priorFrom, toInclusive: minIso(addDays(priorFrom, diffDays(from, today)), addDays(from, -1)) };
      return { current, full: { from, toInclusive: addDays(addMonthsClamped(from, 3), -1) }, prior };
    }
    case "ytd": {
      const from = toIso({ y: fiscalYearOf(today, fsm), m: fsm, d: 1 });
      const current = { from, toInclusive: today };
      return { current, full: { from, toInclusive: addDays(addMonthsClamped(from, 12), -1) }, prior: shiftMonths(current, -12) };
    }
    case "l12m": {
      const current = trailing12(today);
      return { current, full: { from: current.from, toInclusive: monthEnd(today) }, prior: shiftMonths(current, -12) };
    }
  }
}

/** Why a custom range is refused, or null when it's fine. */
export function customRangeError(from: string | undefined, to: string | undefined, today: IsoDate): string | null {
  if (!from || !to) return "Choose a start date and an end date.";
  if (!isIsoDate(from) || !isIsoDate(to)) return "Enter real dates, like 2026-06-01.";
  if (from > to) return "End date must be on or after the start date.";
  if (to > today) return "End date can't be in the future.";
  if (from < EARLIEST_CUSTOM_DATE) return "Start date can't be before 2015.";
  if (addDays(to, 1) > addMonthsClamped(from, MAX_CUSTOM_MONTHS)) return "Choose a range of 3 years or less.";
  return null;
}

function build(preset: PeriodPreset, compareIn: CompareMode, days: PresetDays, today: IsoDate, now: Date, fsm: number): ResolvedPeriod {
  const ref = year(today);
  const compare: CompareMode = FORCED_LY.includes(preset) ? "ly" : compareIn;
  const current = toRange(days.current, ref);
  const lastYear = toRange(shiftMonths(days.current, -12), ref);
  const comparison = compare === "ly" ? lastYear : toRange(days.prior, ref);
  const inProgress = days.current.toInclusive >= today;
  const lastMonth = monthStart(days.current.toInclusive);
  const chartMonths = Array.from({ length: 12 }, (_, i) => monthKey(addMonthsClamped(lastMonth, i - 11)));
  return {
    preset,
    compare,
    today,
    current,
    full: days.full,
    comparison,
    lastYear,
    asOf: current.end < now ? current.end : now,
    inProgress,
    elapsedFraction: inProgress ? (diffDays(days.full.from, today) + 1) / dayCount(days.full) : null,
    fiscalYear: fiscalYearOf(days.current.toInclusive, fsm),
    fiscalYearStartMonth: fsm,
    chartMonths,
    chartWindow: { start: isoToInstant(`${chartMonths[0]}-01`), end: isoToInstant(addMonthsClamped(lastMonth, 1)) },
  };
}

/**
 * Turn the page's query into concrete ranges. Never throws for user input: an
 * invalid custom range comes back as `ok: false` with an error and This month.
 */
export function resolvePeriod(input: PeriodInput, now: Date, opts: { fiscalYearStartMonth: number }): PeriodResult {
  const fsm = Number.isInteger(opts.fiscalYearStartMonth) && opts.fiscalYearStartMonth >= 1 && opts.fiscalYearStartMonth <= 12 ? opts.fiscalYearStartMonth : 1;
  const today = todayIso(now);
  if (input.preset === "custom") {
    const error = customRangeError(input.from, input.to, today);
    if (error) return { ok: false, error, period: build("this_month", input.compare, presetDays("this_month", today, fsm), today, now, fsm) };
    const current = { from: input.from!, toInclusive: input.to! };
    const n = dayCount(current);
    const prior = { from: addDays(current.from, -n), toInclusive: addDays(current.from, -1) };
    return { ok: true, period: build("custom", input.compare, { current, full: current, prior }, today, now, fsm) };
  }
  return { ok: true, period: build(input.preset, input.compare, presetDays(input.preset, today, fsm), today, now, fsm) };
}

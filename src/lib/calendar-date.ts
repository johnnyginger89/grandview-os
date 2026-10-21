/**
 * Vancouver calendar days as plain "YYYY-MM-DD" strings.
 *
 * Calendar math runs on Date.UTC and UTC getters only, so it never depends on the
 * process time zone or on DST. Converting between a calendar day and an instant
 * always goes through America/Vancouver (`businessDate`, `isoToInstant`).
 */
import { BUSINESS_TZ, parseBusinessDateTime } from "./time";

/** A Vancouver calendar day, "YYYY-MM-DD". */
export type IsoDate = string;
/** Calendar day parts, m = 1..12. */
export interface LocalDate {
  y: number;
  m: number;
  d: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const utcMs = (p: LocalDate) => Date.UTC(p.y, p.m - 1, p.d);

function fromUtcMs(ms: number): IsoDate {
  const dt = new Date(ms);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function invalid(what: string, value: unknown): RangeError {
  return new RangeError(`Invalid ${what}: ${JSON.stringify(String(value).slice(0, 40))}`);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** True only for a real calendar day ("2026-02-30" is false). */
export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== "string") return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return y >= 1000 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseIso(s: IsoDate): LocalDate {
  if (!isIsoDate(s)) throw invalid("date", s);
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

export function toIso(p: LocalDate): IsoDate {
  const s = `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
  if (!isIsoDate(s)) throw invalid("date", s);
  return s;
}

export function addDays(s: IsoDate, n: number): IsoDate {
  if (!Number.isInteger(n)) throw invalid("day count", n);
  return fromUtcMs(utcMs(parseIso(s)) + n * DAY_MS);
}

/** Whole days from a to b (b − a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((utcMs(parseIso(b)) - utcMs(parseIso(a))) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(s: IsoDate): number {
  return new Date(utcMs(parseIso(s))).getUTCDay();
}

const dayParts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The Vancouver calendar day an instant falls on. Strings with a zone are taken
 * as-is; bare wall-clock strings are read as Vancouver time (never server time).
 */
export function businessDate(instant: Date | string): IsoDate {
  const dt = instant instanceof Date ? instant : parseBusinessDateTime(instant);
  if (!dt || Number.isNaN(dt.getTime())) throw invalid("instant", instant);
  const parts = dayParts.formatToParts(dt);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return toIso({ y: get("year"), m: get("month"), d: get("day") });
}

/** Today in Vancouver. */
export function todayIso(now: Date = new Date()): IsoDate {
  return businessDate(now);
}

/** The instant of a Vancouver wall-clock time on a calendar day ("HH:MM", default midnight). */
export function isoToInstant(s: IsoDate, time = "00:00"): Date {
  parseIso(s);
  if (!TIME_RE.test(time)) throw invalid("time", time);
  const at = parseBusinessDateTime(`${s}T${time}`);
  if (!at) throw invalid("date", s);
  return at;
}

/** Half-open instants [start of `from`, start of the day after `toInclusive`) in Vancouver. */
export function dayRangeInstants(from: IsoDate, toInclusive: IsoDate): { start: Date; end: Date } {
  return { start: isoToInstant(from), end: isoToInstant(addDays(toInclusive, 1)) };
}

/**
 * Format a calendar day for display. Formats the UTC midnight of that day in UTC,
 * so the label never shifts with the server or browser time zone.
 */
export function formatIsoDate(s: IsoDate, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }).format(new Date(utcMs(parseIso(s))));
}

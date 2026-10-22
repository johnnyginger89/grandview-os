/**
 * Business time zone helpers. Servers run in UTC; Grandview works in
 * America/Vancouver, so wall-clock input without an offset is interpreted there.
 */
export const BUSINESS_TZ = "America/Vancouver";

/**
 * British Columbia stays on UTC−7 all year and doesn't fall back on 2026-11-01
 * (tz database 2026b). Node builds, browsers and servers with older zone data would
 * show every time from then on an hour early, so on those we use a fixed UTC−7 zone
 * from that moment. Runtimes with current data use America/Vancouver as is.
 */
const BC_STAYS_ON_UTC_MINUS_7 = Date.UTC(2026, 10, 1, 9);
const FIXED_UTC_MINUS_7 = "Etc/GMT+7"; // POSIX sign: this is UTC−7
let staleBcData: boolean | undefined;

function hasStaleBcData(): boolean {
  // Mid-January 2027 is −8 only in zone data from before the change.
  staleBcData ??= intlOffsetMinutes(new Date(Date.UTC(2027, 0, 15, 12)), BUSINESS_TZ) === -480;
  return staleBcData;
}

/** Tests only: pretend the runtime's zone data is outdated (true), current (false) or detect it (undefined). */
export function setStaleBcDataForTests(value: boolean | undefined) {
  staleBcData = value;
}

/** The zone to hand to Intl for an instant in Grandview's local time. */
export function businessZone(at: Date | number | string = Date.now()): string {
  const ms = at instanceof Date ? at.getTime() : typeof at === "string" ? Date.parse(at) : at;
  return ms >= BC_STAYS_ON_UTC_MINUS_7 && hasStaleBcData() ? FIXED_UTC_MINUS_7 : BUSINESS_TZ;
}

const zoneFor = (instant: Date, timeZone: string) => (timeZone === BUSINESS_TZ ? businessZone(instant) : timeZone);

/** Minutes the zone is ahead of UTC at the given instant (Vancouver: -420, or -480 before 2026). */
export function zoneOffsetMinutes(instant: Date, timeZone = BUSINESS_TZ): number {
  return intlOffsetMinutes(instant, zoneFor(instant, timeZone));
}

function intlOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parse a date/time string. Strings with an explicit offset or "Z" are taken as-is;
 * bare wall-clock values ("2026-10-23T10:00", "2026-10-23 10:00", "2026-10-23")
 * are read as Vancouver local time. Returns null for unparseable input.
 */
export function parseBusinessDateTime(value: string | Date | null | undefined, timeZone = BUSINESS_TZ): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = value.trim();
  const m = WALL_CLOCK.exec(s);
  if (!m) {
    const written = parseWrittenDateTime(s);
    if (written) return fromWallClock(written, timeZone);
    if (!HAS_ZONE.test(s)) return null; // never let the server's UTC clock guess a zone
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [, y, mo, da, h = "0", mi = "0", se = "0"] = m;
  return fromWallClock({ y: +y, mo: +mo, d: +da, h: +h, mi: +mi, s: +se }, timeZone);
}

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2}|\bGMT\b|\bUTC\b)/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

interface WallClock { y: number; mo: number; d: number; h: number; mi: number; s: number }

/**
 * Written dates as booking tools print them, e.g. "Thursday, October 23, 2026 10:00 AM",
 * "23 October 2026 at 14:30", "Oct 23 2026 2:30pm". Read as business-zone wall clock.
 */
function parseWrittenDateTime(input: string): WallClock | null {
  if (HAS_ZONE.test(input)) return null;
  const s = input.toLowerCase().replace(/,/g, " ").replace(/\bat\b/g, " ").replace(/\s+/g, " ").trim();
  const monthIdx = MONTHS.findIndex((m) => new RegExp(`\\b${m}[a-z]*\\.?\\b`).test(s));
  if (monthIdx < 0) return null;
  const year = /\b(20\d{2})\b/.exec(s);
  if (!year) return null;
  const rest = s.replace(year[0], " ");
  const day = /\b([0-3]?\d)(?:st|nd|rd|th)?\b(?!\s*:)/.exec(rest.replace(/\d{1,2}:\d{2}/g, " "));
  if (!day) return null;
  const time = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\s|$)/.exec(rest.replace(day[0], " ").replace(/\b[a-z]+day\b/g, " "));
  let h = 0;
  let mi = 0;
  if (time && (time[2] || time[3])) {
    h = Number(time[1]);
    mi = Number(time[2] ?? 0);
    const ap = time[3]?.replace(/\./g, "");
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
  }
  const d = Number(day[1]);
  if (d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return { y: Number(year[1]), mo: monthIdx + 1, d, h, mi, s: 0 };
}

function fromWallClock(w: WallClock, timeZone: string): Date {
  const { y, mo, d: da, h, mi, s: se } = w;
  const guess = Date.UTC(+y, +mo - 1, +da, +h, +mi, +se);
  // Two passes handle instants near a DST change.
  let utc = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  utc = guess - zoneOffsetMinutes(new Date(utc), timeZone) * 60_000;
  return new Date(utc);
}

/** Start of the current month in the business time zone, as a UTC instant. */
export function startOfBusinessMonth(now = new Date(), timeZone = BUSINESS_TZ): Date {
  const local = new Date(now.getTime() + zoneOffsetMinutes(now, timeZone) * 60_000);
  const ym = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-01T00:00`;
  return parseBusinessDateTime(ym, timeZone)!;
}

/** An instant as Vancouver wall-clock time, "2026-10-29T10:00", e.g. to fill a date-and-time box. */
export function businessWallClock(instant: Date, timeZone = BUSINESS_TZ): string {
  return new Date(instant.getTime() + zoneOffsetMinutes(instant, timeZone) * 60_000).toISOString().slice(0, 16);
}

/** Hour of day (0–23) in the business time zone. */
export function businessHour(now = new Date(), timeZone = BUSINESS_TZ): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: zoneFor(now, timeZone), hour: "2-digit", hourCycle: "h23" }).format(now));
}

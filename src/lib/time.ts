/**
 * Business time zone helpers. Servers run in UTC; Grandview works in
 * America/Vancouver, so wall-clock input without an offset is interpreted there.
 */
export const BUSINESS_TZ = "America/Vancouver";

/** Minutes the zone is ahead of UTC at the given instant (Vancouver: -420 or -480). */
export function zoneOffsetMinutes(instant: Date, timeZone = BUSINESS_TZ): number {
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
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [, y, mo, da, h = "0", mi = "0", se = "0"] = m;
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

/** Hour of day (0–23) in the business time zone. */
export function businessHour(now = new Date(), timeZone = BUSINESS_TZ): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
}

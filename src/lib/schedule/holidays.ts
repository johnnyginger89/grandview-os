/**
 * BC statutory holidays and owner-defined closed days. Checked against the BC
 * government's 2026/2027 table (spec-schedule §11). Easter Monday and Boxing Day
 * are not BC stats, and BC gives pay rather than a substitute day for a stat on a
 * weekend, so only the actual date is listed (except Canada Day on a Sunday).
 */
import { addDays, dayOfWeek, diffDays, parseIso, toIso, type IsoDate } from "@/lib/calendar-date";
import type { ScheduleSettings } from "./settings-schema";

export const BC_STAT_HOLIDAYS_URL =
  "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/statutory-holidays";

export interface ClosedDay {
  date: IsoDate;
  /** Full name, e.g. "Thanksgiving Day". */
  label: string;
  /** For narrow day headers, e.g. "Thanksgiving". */
  short: string;
  source: "bc_stat" | "company";
}

/** Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso({ y: year, m: month, d: day });
}

/** The nth (1-based) Monday of a month. */
function nthMonday(year: number, month: number, n: number): IsoDate {
  const first = toIso({ y: year, m: month, d: 1 });
  const offset = (8 - dayOfWeek(first)) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

const stat = (date: IsoDate, label: string, short = label): ClosedDay => ({ date, label, short, source: "bc_stat" });

export function bcStatHolidays(year: number): ClosedDay[] {
  const may24 = toIso({ y: year, m: 5, d: 24 });
  const canadaDay = toIso({ y: year, m: 7, d: 1 });
  const days = [
    stat(toIso({ y: year, m: 1, d: 1 }), "New Year's Day"),
    stat(nthMonday(year, 2, 3), "Family Day"),
    stat(addDays(easterSunday(year), -2), "Good Friday"),
    // The Monday before May 25.
    stat(addDays(may24, -((dayOfWeek(may24) + 6) % 7)), "Victoria Day"),
    stat(canadaDay, "Canada Day"),
  ];
  // Holidays Act s.2(2): when July 1 is a Sunday, July 2 is the holiday.
  if (dayOfWeek(canadaDay) === 0) days.push(stat(addDays(canadaDay, 1), "Canada Day (observed)"));
  days.push(
    stat(nthMonday(year, 8, 1), "B.C. Day"),
    stat(nthMonday(year, 9, 1), "Labour Day"),
    stat(toIso({ y: year, m: 9, d: 30 }), "National Day for Truth and Reconciliation", "Truth & Reconciliation"),
    stat(nthMonday(year, 10, 2), "Thanksgiving Day", "Thanksgiving"),
    stat(toIso({ y: year, m: 11, d: 11 }), "Remembrance Day"),
    stat(toIso({ y: year, m: 12, d: 25 }), "Christmas Day", "Christmas"),
  );
  return days;
}

/** Closed days in [from, to] (inclusive): BC stats (unless the region is "none") plus the owner's extra closed days. */
export function closedDaysBetween(
  from: IsoDate,
  to: IsoDate,
  s: Pick<ScheduleSettings, "holidayRegion" | "extraClosedDays">,
): Map<IsoDate, ClosedDay> {
  const out = new Map<IsoDate, ClosedDay>();
  if (diffDays(from, to) < 0) return out;
  const inRange = (d: IsoDate) => d >= from && d <= to;
  if (s.holidayRegion === "BC") {
    for (let y = parseIso(from).y; y <= parseIso(to).y; y++) for (const h of bcStatHolidays(y)) if (inRange(h.date)) out.set(h.date, h);
  }
  for (const c of s.extraClosedDays) {
    if (inRange(c.date) && !out.has(c.date)) out.set(c.date, { date: c.date, label: c.label, short: c.label, source: "company" });
  }
  return out;
}

/** "Thanksgiving Day – BC statutory holiday" / "Christmas shutdown – company closed". */
export function closedDayTitle(c: ClosedDay): string {
  return `${c.label} – ${c.source === "bc_stat" ? "BC statutory holiday" : "company closed"}`;
}

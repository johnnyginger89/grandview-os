/**
 * Calendar-day helpers for the schedule. The shared Vancouver calendar-day module
 * (`src/lib/calendar-date.ts`) owns parsing, today, instants and formatting; this
 * file only adds grid helpers. Never pass a `date` column to formatDate() from
 * src/lib/utils.ts: use formatIsoDate.
 */
import { addDays, dayOfWeek, diffDays, parseIso, toIso, type IsoDate } from "@/lib/calendar-date";

export {
  addDays,
  businessDate,
  dayOfWeek,
  diffDays,
  formatIsoDate,
  isIsoDate,
  isoToInstant,
  parseIso,
  todayIso,
  toIso,
  type IsoDate,
} from "@/lib/calendar-date";

export const MAX_EACH_DAY = 400;

/** Every day from `from` to `to`, inclusive. Empty when `to` is before `from`; throws beyond 400 days. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const n = diffDays(from, to);
  if (n < 0) return [];
  if (n >= MAX_EACH_DAY) throw new RangeError(`Date range too long: ${from} to ${to}`);
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/** First day of the week containing `s`; weeks start on Sunday (0) or Monday (1). */
export function startOfWeek(s: IsoDate, weekStartsOn: 0 | 1): IsoDate {
  const back = (dayOfWeek(s) - weekStartsOn + 7) % 7;
  return addDays(s, -back);
}

export function mondayOf(s: IsoDate): IsoDate {
  return startOfWeek(s, 1);
}

/** Month view: 6 rows × 7 days covering `month` (1–12) of `year`. */
export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1): IsoDate[][] {
  const first = startOfWeek(toIso({ y: year, m: month, d: 1 }), weekStartsOn);
  return Array.from({ length: 6 }, (_, r) => Array.from({ length: 7 }, (_, c) => addDays(first, r * 7 + c)));
}

/** The 1st of the month containing `s`. */
export function startOfMonth(s: IsoDate): IsoDate {
  const { y, m } = parseIso(s);
  return toIso({ y, m, d: 1 });
}

/** Earlier / later of two days (ISO strings compare correctly as text). */
export const minIso = (a: IsoDate, b: IsoDate): IsoDate => (a <= b ? a : b);
export const maxIso = (a: IsoDate, b: IsoDate): IsoDate => (a >= b ? a : b);

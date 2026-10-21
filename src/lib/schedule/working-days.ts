/** Working-day arithmetic on a company or crew calendar (weekends, stats and closed days skipped). */
import { addDays, dayOfWeek, diffDays, type IsoDate } from "@/lib/calendar-date";
import { closedDaysBetween, type ClosedDay } from "./holidays";
import type { ScheduleSettings } from "./settings-schema";

export interface WorkCalendar {
  workDays: ReadonlySet<number>;
  closed: ReadonlyMap<IsoDate, ClosedDay>;
}

const MAX_SCAN_DAYS = 60;
const MAX_ADD_SCAN_DAYS = 800;
const SATURDAY = 6;
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The company work days, plus Saturday for a crew that works Saturdays. */
export function crewCalendar(
  settings: Pick<ScheduleSettings, "workDays">,
  crew: { worksSaturdays: boolean } | null | undefined,
  closed: ReadonlyMap<IsoDate, ClosedDay>,
): WorkCalendar {
  const workDays = new Set(settings.workDays);
  if (crew?.worksSaturdays) workDays.add(SATURDAY);
  return { workDays, closed };
}

/**
 * Calendars for a date range: closed days are computed once, and each crew's
 * calendar (Saturdays or not) is reused. `null` = the company calendar.
 */
export function calendarsFor(settings: Pick<ScheduleSettings, "workDays" | "holidayRegion" | "extraClosedDays">, from: IsoDate, to: IsoDate) {
  const closed = closedDaysBetween(from, to, settings);
  const company = crewCalendar(settings, null, closed);
  const saturdays = crewCalendar(settings, { worksSaturdays: true }, closed);
  return {
    closed,
    calFor: (crew: { worksSaturdays: boolean } | null | undefined): WorkCalendar => (crew?.worksSaturdays ? saturdays : company),
  };
}

export function isWorkingDay(d: IsoDate, cal: WorkCalendar): boolean {
  return cal.workDays.has(dayOfWeek(d)) && !cal.closed.has(d);
}

/** `d` itself when it's a working day, else the next one (scans at most 60 days, then gives up and returns `d`). */
export function nextWorkingDay(d: IsoDate, cal: WorkCalendar): IsoDate {
  for (let i = 0; i <= MAX_SCAN_DAYS; i++) {
    const day = addDays(d, i);
    if (isWorkingDay(day, cal)) return day;
  }
  return d;
}

/** Inclusive end of `n` working days starting at `start` (snapped to a working day first). */
export function addWorkingDays(start: IsoDate, n: number, cal: WorkCalendar): IsoDate {
  let day = nextWorkingDay(start, cal);
  let left = Math.max(1, Math.trunc(n)) - 1;
  for (let i = 0; left > 0 && i < MAX_ADD_SCAN_DAYS; i++) {
    day = addDays(day, 1);
    if (isWorkingDay(day, cal)) left--;
  }
  return day;
}

export function countWorkingDays(start: IsoDate, end: IsoDate, cal: WorkCalendar): number {
  const n = diffDays(start, end);
  let count = 0;
  for (let i = 0; i <= n; i++) if (isWorkingDay(addDays(start, i), cal)) count++;
  return count;
}

/** Days in [start, end] that aren't worked, with why ("Thanksgiving Day", "Saturday"). */
export function nonWorkingDaysIn(start: IsoDate, end: IsoDate, cal: WorkCalendar): { date: IsoDate; label: string }[] {
  const n = diffDays(start, end);
  const out: { date: IsoDate; label: string }[] = [];
  for (let i = 0; i <= n; i++) {
    const date = addDays(start, i);
    if (isWorkingDay(date, cal)) continue;
    out.push({ date, label: cal.closed.get(date)?.label ?? WEEKDAY[dayOfWeek(date)] });
  }
  return out;
}

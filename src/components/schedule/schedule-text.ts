/** Plain-language text for schedule warnings and booking ranges (pure; unit-tested). */
import { addDays, diffDays, isIsoDate, type IsoDate } from "@/lib/calendar-date";
import { MAX_BOOKING_SPAN_DAYS, MAX_WORKING_DAYS } from "@/lib/schedule/constants";
import { dateRangeLabel, longDay, shortDay, workingDaysLabel } from "@/lib/schedule/format";
import type { ScheduleWarning } from "@/lib/schedule/types";
import { addWorkingDays, countWorkingDays, nextWorkingDay, type WorkCalendar } from "@/lib/schedule/working-days";

/** "Tue, Oct 27 and Wed, Oct 28" / "Mon, Oct 26, Tue, Oct 27 and 3 more days". */
export function dayList(dates: readonly IsoDate[], max = 2): string {
  const shown = dates.slice(0, max).map(shortDay);
  const rest = dates.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more day${rest === 1 ? "" : "s"}`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : (shown[0] ?? "");
}

const jobs = (numbers: readonly number[]) => numbers.map((n) => `#${n}`).join(", ");

export function warningText(w: ScheduleWarning): string {
  switch (w.type) {
    case "double_booked":
      return `Double-booked: ${w.crewName || "this crew"} also has ${w.otherProjectNumbers.length ? jobs(w.otherProjectNumbers) : "another job"} on ${dayList(w.dates)}.`;
    case "person_double_booked":
      return `${w.userName} is booked with two crews on ${dayList(w.dates)}.`;
    case "non_working":
      return `Includes ${w.days.length} day${w.days.length === 1 ? "" : "s"} off (${[...new Set(w.days.map((d) => d.label))].join(", ")}). They aren't counted as work days.`;
    case "not_ready":
      return `Not ready yet: ${w.missing.join(", ")}.`;
    case "before_not_before":
      return `Starts before the "not before" date (${shortDay(w.notBefore)}).`;
    case "in_past":
      return "The start date is in the past.";
    case "customer_told":
      return `Customer was told ${shortDay(w.communicatedStart)} · now ${shortDay(w.newStart)}. Send them the updated date.`;
  }
}

/** For toasts: the warnings worth a heads-up after a drag, in one line. */
export function warningsSummary(ws: readonly ScheduleWarning[]): string {
  const important = ws.filter((w) => w.type !== "non_working");
  if (!important.length) return "";
  return `Heads up: ${important.map((w) => warningText(w).replace(/\.$/, "")).join(" · ")}.`;
}

/** "Customer was told Mon, Oct 26 · now Wed, Oct 28". */
export function customerToldText(told: IsoDate, now: IsoDate): string {
  return `Customer was told ${shortDay(told)} · now ${shortDay(now)}`;
}

/** "Mon, Oct 26 → Tue, Oct 27 · 2 work days". */
export function previewRangeText(start: IsoDate, end: IsoDate, workingDays: number): string {
  return `${start === end ? shortDay(start) : `${shortDay(start)} → ${shortDay(end)}`} · ${workingDays} work day${workingDays === 1 ? "" : "s"}`;
}

export { dateRangeLabel, longDay, shortDay, workingDaysLabel };

// ---------------------------------------------------------------------------
// The entry form's dates: start + working days ⇄ end (live)
// ---------------------------------------------------------------------------

export interface RangeInput {
  start: string;
  end: string;
  days: string;
  /** Which of the two the user set last: the other is computed. */
  mode: "days" | "end";
}

export type RangeResult =
  | { ok: true; startDate: IsoDate; endDate: IsoDate; workingDays: number; snappedFrom: IsoDate | null }
  | { ok: false; error: string };

export function resolveRange(r: RangeInput, cal: WorkCalendar): RangeResult {
  if (!isIsoDate(r.start)) return { ok: false, error: "Pick a start date." };
  if (r.mode === "days") {
    const n = Number(r.days);
    if (!Number.isInteger(n) || n < 1 || n > MAX_WORKING_DAYS) return { ok: false, error: `Working days must be a whole number from 1 to ${MAX_WORKING_DAYS}.` };
    const startDate = nextWorkingDay(r.start, cal);
    const endDate = addWorkingDays(startDate, n, cal);
    if (diffDays(startDate, endDate) > MAX_BOOKING_SPAN_DAYS) return { ok: false, error: "Bookings can be at most 6 months long." };
    return { ok: true, startDate, endDate, workingDays: n, snappedFrom: startDate !== r.start ? r.start : null };
  }
  if (!isIsoDate(r.end)) return { ok: false, error: "Pick an end date." };
  if (r.end < r.start) return { ok: false, error: "The end date is before the start date." };
  if (diffDays(r.start, r.end) > MAX_BOOKING_SPAN_DAYS) return { ok: false, error: "Bookings can be at most 6 months long." };
  return { ok: true, startDate: r.start, endDate: r.end, workingDays: countWorkingDays(r.start, r.end, cal), snappedFrom: null };
}

/** The day after `d` (for "+ Add phase" after the last work day). */
export const dayAfter = (d: IsoDate) => addDays(d, 1);

/** The date math behind drag, resize and keyboard moves (the pointer hook only does hit-testing). */
import { addDays, diffDays, type IsoDate } from "@/lib/calendar-date";
import { MAX_BOOKING_SPAN_DAYS } from "./constants";
import { addWorkingDays, countWorkingDays, nextWorkingDay, type WorkCalendar } from "./working-days";

export type DragMode = "move" | "resize-start" | "resize-end" | "create";
export const DRAG_THRESHOLD_PX = 4;

export interface DateRange {
  startDate: IsoDate;
  endDate: IsoDate;
}

/** Column under the pointer, clamped to the grid. */
export function dayIndexFromX(clientX: number, cellsLeft: number, colWidth: number, count: number): number {
  if (count < 1) return 0;
  if (!(colWidth > 0)) return 0;
  const i = Math.floor((clientX - cellsLeft) / colWidth);
  return Math.min(count - 1, Math.max(0, i));
}

/**
 * Move a booking by `deltaDays`, possibly onto another crew's calendar. The number of
 * working days is kept and the start snaps to a working day. A booking with no
 * working days at all (an explicit weekend visit) moves as-is.
 */
export function applyMove(e: DateRange, deltaDays: number, fromCal: WorkCalendar, toCal: WorkCalendar): DateRange {
  const shiftedStart = addDays(e.startDate, deltaDays);
  const workDays = countWorkingDays(e.startDate, e.endDate, fromCal);
  if (workDays === 0) return { startDate: shiftedStart, endDate: addDays(e.endDate, deltaDays) };
  const startDate = nextWorkingDay(shiftedStart, toCal);
  return clampSpan({ startDate, endDate: addWorkingDays(startDate, workDays, toCal) });
}

/** Drag one edge. The booking stays at least one day and never crosses itself. No snapping: the user chose the day. */
export function applyResize(e: DateRange, edge: "start" | "end", deltaDays: number): DateRange {
  if (edge === "start") {
    let startDate = addDays(e.startDate, deltaDays);
    if (startDate > e.endDate) startDate = e.endDate;
    if (diffDays(startDate, e.endDate) > MAX_BOOKING_SPAN_DAYS) startDate = addDays(e.endDate, -MAX_BOOKING_SPAN_DAYS);
    return { startDate, endDate: e.endDate };
  }
  let endDate = addDays(e.endDate, deltaDays);
  if (endDate < e.startDate) endDate = e.startDate;
  if (diffDays(e.startDate, endDate) > MAX_BOOKING_SPAN_DAYS) endDate = addDays(e.startDate, MAX_BOOKING_SPAN_DAYS);
  return { startDate: e.startDate, endDate };
}

/** A new booking dropped on `dropDate`: snapped forward to a working day, `workingDays` long. */
export function applyCreate(dropDate: IsoDate, workingDays: number, cal: WorkCalendar): DateRange {
  const startDate = nextWorkingDay(dropDate, cal);
  return clampSpan({ startDate, endDate: addWorkingDays(startDate, workingDays, cal) });
}

function clampSpan(r: DateRange): DateRange {
  return diffDays(r.startDate, r.endDate) > MAX_BOOKING_SPAN_DAYS ? { startDate: r.startDate, endDate: addDays(r.startDate, MAX_BOOKING_SPAN_DAYS) } : r;
}

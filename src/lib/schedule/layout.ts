/** Where a booking's bar sits in the timeline window or the month grid. Columns are 0-based. */
import { diffDays, type IsoDate } from "@/lib/calendar-date";

export interface BarGeometry {
  col: number;
  span: number;
  /** The booking continues before / after the visible window (◂ ▸ markers). */
  clipStart: boolean;
  clipEnd: boolean;
}

/** Null when the booking is entirely outside the window. */
export function barGeometry(e: { startDate: IsoDate; endDate: IsoDate }, window: { from: IsoDate; days: number }): BarGeometry | null {
  const first = diffDays(window.from, e.startDate);
  const last = diffDays(window.from, e.endDate);
  if (window.days < 1 || last < 0 || first > window.days - 1) return null;
  const col = Math.max(0, first);
  const end = Math.min(window.days - 1, last);
  return { col, span: end - col + 1, clipStart: first < 0, clipEnd: last > window.days - 1 };
}

/** One segment per week row the booking touches in a month grid (from monthGrid()). */
export function monthSegments(e: { startDate: IsoDate; endDate: IsoDate }, grid: IsoDate[][]): (BarGeometry & { row: number })[] {
  const out: (BarGeometry & { row: number })[] = [];
  grid.forEach((week, row) => {
    const g = barGeometry(e, { from: week[0], days: week.length });
    if (g) out.push({ row, ...g });
  });
  return out;
}

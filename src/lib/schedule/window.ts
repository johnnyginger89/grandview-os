/** Turns the /schedule URL state into the exact days to load and show. */
import { addDays, parseIso, toIso, type IsoDate } from "@/lib/calendar-date";
import { monthGrid, startOfWeek } from "./dates";
import type { WindowQuery } from "./schemas";
import type { ScheduleSettings } from "./settings-schema";

export interface ScheduleWindow {
  view: "timeline" | "month";
  /** First and last day shown (inclusive); pass to getScheduleWindow. */
  from: IsoDate;
  to: IsoDate;
  /** Timeline: 7, 14 or 28 days. Month: 42 (the 6 × 7 grid). */
  days: number;
  span: 7 | 14 | 28;
  /** Month view: the month being shown, as its 1st day. */
  month: IsoDate | null;
  crews: string[];
  focus: string | undefined;
}

export function resolveWindow(q: WindowQuery, settings: Pick<ScheduleSettings, "weekStartsOn" | "defaultSpanDays">, today: IsoDate): ScheduleWindow {
  const span = q.span ?? settings.defaultSpanDays;
  const anchor = q.from ?? today;
  if (q.view === "month") {
    const { y, m } = parseIso(anchor);
    const grid = monthGrid(y, m, settings.weekStartsOn);
    return { view: "month", from: grid[0][0], to: grid[5][6], days: 42, span, month: toIso({ y, m, d: 1 }), crews: q.crews, focus: q.focus };
  }
  const from = startOfWeek(anchor, settings.weekStartsOn);
  return { view: "timeline", from, to: addDays(from, span - 1), days: span, span, month: null, crews: q.crews, focus: q.focus };
}

/** The `from` for Prev (-1) / Next (+1): one span on the timeline, one month on the month view. */
export function shiftWindow(w: ScheduleWindow, direction: -1 | 1): IsoDate {
  if (w.view === "month" && w.month) {
    const { y, m } = parseIso(w.month);
    const n = y * 12 + (m - 1) + direction;
    return toIso({ y: Math.floor(n / 12), m: (n % 12) + 1, d: 1 });
  }
  return addDays(w.from, direction * w.span);
}

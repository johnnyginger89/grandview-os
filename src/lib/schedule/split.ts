/** Splitting a booking in two (a rain day): the second part starts on the next working day. */
import { addDays, type IsoDate } from "@/lib/calendar-date";
import { splitHours } from "./duration";
import { countWorkingDays, nextWorkingDay, type WorkCalendar } from "./working-days";

export interface SplitPart {
  startDate: IsoDate;
  endDate: IsoDate;
  plannedHours: string | null;
}

/** Null when `firstPartEnd` isn't inside the booking before its last day. */
export function planSplit(
  e: { startDate: IsoDate; endDate: IsoDate; plannedHours: string | null },
  firstPartEnd: IsoDate,
  cal: WorkCalendar,
): { first: SplitPart; second: SplitPart } | null {
  if (firstPartEnd < e.startDate || firstPartEnd >= e.endDate) return null;
  const dayAfter = addDays(firstPartEnd, 1);
  const snapped = nextWorkingDay(dayAfter, cal);
  const secondStart = snapped <= e.endDate ? snapped : dayAfter;
  let firstHours: string | null = null;
  let secondHours: string | null = null;
  if (e.plannedHours !== null && e.plannedHours !== "") {
    [firstHours, secondHours] = splitHours(e.plannedHours, countWorkingDays(e.startDate, firstPartEnd, cal), countWorkingDays(secondStart, e.endDate, cal));
  }
  return {
    first: { startDate: e.startDate, endDate: firstPartEnd, plannedHours: firstHours },
    second: { startDate: secondStart, endDate: e.endDate, plannedHours: secondHours },
  };
}

/** Display text for bookings. Calendar days are formatted with formatIsoDate (TZ-proof), never formatDate. */
import { formatIsoDate, type IsoDate } from "@/lib/calendar-date";
import type { CrewKind, CrewTrade, ScheduleEntryKind } from "./constants";

/** The job title: the estimate title, else the part of the project name after " – ". */
export function jobTitle(projectName: string, estimateTitle?: string | null): string {
  const t = estimateTitle?.trim();
  if (t) return t;
  const i = projectName.indexOf(" – ");
  return (i >= 0 ? projectName.slice(i + 3) : projectName).trim() || projectName;
}

export const KIND_LABEL: Record<ScheduleEntryKind, string> = {
  work: "Painting",
  pressure_wash: "Pressure wash",
  colour_consult: "Colour consult",
  walk_through: "Walk-through",
  touch_up: "Touch-up",
};

export function kindLabel(kind: ScheduleEntryKind): string {
  return KIND_LABEL[kind] ?? kind;
}

export const CREW_KIND_LABEL: Record<CrewKind, string> = { in_house: "In-house", subcontractor: "Subcontractor" };
export const CREW_TRADE_LABEL: Record<CrewTrade, string> = {
  painting: "Painting",
  pressure_washing: "Pressure washing",
  carpentry: "Carpentry",
  drywall: "Drywall",
  other: "Other",
};

/** "Mon, Oct 26". */
export function shortDay(d: IsoDate): string {
  return formatIsoDate(d, { weekday: "short", month: "short", day: "numeric" });
}

/** "Monday, October 26". */
export function longDay(d: IsoDate): string {
  return formatIsoDate(d, { weekday: "long", month: "long", day: "numeric" });
}

/** "Mon, Oct 26 – Tue, Oct 27", or one day. */
export function dateRangeLabel(start: IsoDate, end: IsoDate): string {
  return start === end ? shortDay(start) : `${shortDay(start)} – ${shortDay(end)}`;
}

/** "1 working day" / "5 working days". */
export function workingDaysLabel(n: number): string {
  return `${n} working day${n === 1 ? "" : "s"}`;
}

/** For screen readers: "Job 3018, Kim, painting, Niko, Monday, October 26 to Tuesday, October 27, 2 working days, tentative". */
export function entryAriaLabel(e: {
  projectNumber: number;
  customerName: string;
  kind: ScheduleEntryKind;
  crewName: string | null;
  startDate: IsoDate;
  endDate: IsoDate;
  workingDays: number;
  tentative: boolean;
  conflict?: boolean;
  phaseLabel?: string | null;
}): string {
  const dates = e.startDate === e.endDate ? longDay(e.startDate) : `${longDay(e.startDate)} to ${longDay(e.endDate)}`;
  return [
    `Job ${e.projectNumber}`,
    e.customerName,
    kindLabel(e.kind).toLowerCase(),
    e.phaseLabel || null,
    e.crewName ?? "unassigned",
    dates,
    workingDaysLabel(e.workingDays),
    e.tentative ? "tentative" : null,
    e.conflict ? "double-booked" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

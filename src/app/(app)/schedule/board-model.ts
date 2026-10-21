/**
 * Pure helpers behind the /schedule board (no React, no DOM), so they're unit-tested.
 * The date math itself lives in src/lib/schedule; this file arranges it for the views.
 */
import { addDays, diffDays, type IsoDate } from "@/lib/calendar-date";
import type { ScheduleEntryKind } from "@/lib/schedule/constants";
import { conflictsForEntry, findCrewConflicts, type EntryLike } from "@/lib/schedule/conflicts";
import { maxIso, minIso } from "@/lib/schedule/dates";
import { applyCreate, applyMove, applyResize, type DateRange } from "@/lib/schedule/drag";
import { suggestedWorkingDays, type CrewCapacity } from "@/lib/schedule/duration";
import type { ClosedDay } from "@/lib/schedule/holidays";
import { barGeometry } from "@/lib/schedule/layout";
import type { ScheduleSettings } from "@/lib/schedule/settings-schema";
import type { CrewDTO, EntryDTO, UnscheduledJobDTO } from "@/lib/schedule/types";
import { calendarsFor, countWorkingDays, isWorkingDay, nextWorkingDay, type WorkCalendar } from "@/lib/schedule/working-days";

/** Row key of the Unassigned row (crewId null). */
export const UNASSIGNED_KEY = "unassigned";
export const rowKey = (crewId: string | null) => crewId ?? UNASSIGNED_KEY;

export type CalFor = (crew: { worksSaturdays: boolean } | null | undefined) => WorkCalendar;

/**
 * Calendars for the board. Closed days are computed well beyond the window, because
 * moving a booking can push its end weeks past the last visible day.
 */
export function boardCalendars(settings: Pick<ScheduleSettings, "workDays" | "holidayRegion" | "extraClosedDays">, from: IsoDate, to: IsoDate) {
  return calendarsFor(settings, addDays(from, -400), addDays(to, 800));
}

export interface CrewRow {
  key: string;
  crewId: string | null;
  name: string;
  crew: CrewDTO | null;
  /** Inactive crews keep their row while they have bookings, but take no new ones. */
  droppable: boolean;
}

/** Crew rows in their set order (filtered when a filter is set), then Unassigned. */
export function crewRows(crews: readonly CrewDTO[], filter: readonly string[]): CrewRow[] {
  const shown = filter.length ? crews.filter((c) => filter.includes(c.id)) : crews;
  return [
    ...[...shown]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((c) => ({ key: c.id, crewId: c.id, name: c.name, crew: c, droppable: c.active })),
    { key: UNASSIGNED_KEY, crewId: null, name: "Unassigned", crew: null, droppable: true },
  ];
}

/** Bookings shown with the crew filter applied (Unassigned always shows). */
export function filterEntries<T extends { crewId: string | null }>(entries: readonly T[], filter: readonly string[]): T[] {
  return filter.length ? entries.filter((e) => e.crewId === null || filter.includes(e.crewId)) : [...entries];
}

export interface EntryConflict {
  dates: IsoDate[];
  /** Other jobs booked on the same crew and days. */
  otherNumbers: number[];
}

/** Double-booked bars in view: entry id → the days and the other job numbers. */
export function windowConflicts(entries: readonly EntryDTO[], crewsById: ReadonlyMap<string, CrewDTO>, calFor: CalFor): Map<string, EntryConflict> {
  const found = findCrewConflicts([...entries], (crewId) => calFor(crewsById.get(crewId)));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const acc = new Map<string, { dates: Set<IsoDate>; others: Set<number> }>();
  for (const c of found) {
    for (const id of c.entryIds) {
      const a = acc.get(id) ?? { dates: new Set<IsoDate>(), others: new Set<number>() };
      a.dates.add(c.date);
      for (const other of c.entryIds) if (other !== id) a.others.add(byId.get(other)?.projectNumber ?? 0);
      acc.set(id, a);
    }
  }
  return new Map([...acc].map(([id, a]) => [id, { dates: [...a.dates].sort(), otherNumbers: [...a.others].sort((x, y) => x - y) }]));
}

/** Search by customer, #number, city or job title. */
export function matchesSearch(q: string, x: { number: number; customerName: string; city: string | null; jobTitle?: string | null }): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/^#/, "");
  if (/^\d+$/.test(digits)) return String(x.number).startsWith(digits);
  return [x.customerName, x.city ?? "", x.jobTitle ?? ""].some((f) => f.toLowerCase().includes(s));
}

/** Working days in [from, to] on which this crew has at least one booking. */
export function bookedDays(entries: readonly EntryLike[], crewId: string | null, from: IsoDate, to: IsoDate, cal: WorkCalendar): number {
  const days = new Set<IsoDate>();
  for (const e of entries) {
    if (e.crewId !== crewId) continue;
    const a = maxIso(e.startDate, from);
    const b = minIso(e.endDate, to);
    for (let i = 0, n = diffDays(a, b); i <= n; i++) {
      const d = addDays(a, i);
      if (isWorkingDay(d, cal)) days.add(d);
    }
  }
  return days.size;
}

/** Suggested length for a job on a crew (or the default crew before one is chosen). */
export function suggestDays(job: Pick<UnscheduledJobDTO, "remainingHours">, crew: CrewCapacity | null | undefined, fallback: CrewCapacity): number {
  return suggestedWorkingDays(job.remainingHours, crew ?? fallback);
}

/** "Ext" / "Int" tag from the estimate job type. */
export function jobTypeTag(jobType: string | null): string | null {
  if (!jobType) return null;
  const t = jobType.toLowerCase();
  if (t === "interior_exterior") return "Int + Ext";
  if (t.includes("exterior")) return "Ext";
  if (t.includes("interior")) return "Int";
  if (t.includes("cabinet")) return "Cabinets";
  if (t.includes("stain")) return "Staining";
  return jobType.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Drag and keyboard plans
// ---------------------------------------------------------------------------

export type DragSubject =
  | { kind: "entry"; entry: EntryDTO; mode: "move" | "resize-start" | "resize-end" }
  | { kind: "job"; job: UnscheduledJobDTO };

/** The cell under the pointer. crewId undefined = the month view (the crew doesn't change). */
export interface CellHit {
  date: IsoDate;
  crewId: string | null | undefined;
}

export interface DropPlan extends DateRange {
  crewId: string | null;
  workingDays: number;
  conflict: boolean;
  /** False when the target can't take the booking (an inactive crew). */
  valid: boolean;
  reason: string | null;
  /** False when the booking would end up where it started. */
  changed: boolean;
}

export interface PlanContext {
  crewsById: ReadonlyMap<string, CrewDTO>;
  calFor: CalFor;
  /** Everything on the board, for the live double-booking check. */
  entries: readonly EntryLike[];
  fallback: CrewCapacity;
  /** Month view: new bookings go to this crew (the first filtered crew) or Unassigned. */
  monthCrewId: string | null;
}

const NEW_ID = "__new__";

export function planDrop(subject: DragSubject, hit: CellHit, grab: IsoDate | null, ctx: PlanContext): DropPlan {
  const fromCrewId = subject.kind === "entry" ? subject.entry.crewId : null;
  const crewId = hit.crewId === undefined ? (subject.kind === "entry" ? subject.entry.crewId : ctx.monthCrewId) : hit.crewId;
  const crew = crewId ? (ctx.crewsById.get(crewId) ?? null) : null;
  const cal = ctx.calFor(crew);

  let range: DateRange;
  if (subject.kind === "job") {
    range = applyCreate(hit.date, suggestDays(subject.job, crew, ctx.fallback), cal);
  } else {
    const e = subject.entry;
    if (subject.mode === "move") {
      const fromCal = ctx.calFor(fromCrewId ? ctx.crewsById.get(fromCrewId) : null);
      range = applyMove(e, diffDays(grab ?? e.startDate, hit.date), fromCal, cal);
    } else {
      const edge = subject.mode === "resize-start" ? "start" : "end";
      range = applyResize(e, edge, diffDays(grab ?? (edge === "start" ? e.startDate : e.endDate), hit.date));
    }
  }

  const inactive = !!crewId && (!crew || !crew.active) && crewId !== fromCrewId;
  const self: EntryLike =
    subject.kind === "entry"
      ? { id: subject.entry.id, crewId, projectId: subject.entry.projectId, kind: subject.entry.kind, ...range }
      : { id: NEW_ID, crewId, projectId: subject.job.projectId, kind: "work", ...range };
  const conflict = conflictsForEntry(self, [...ctx.entries], cal).dates.length > 0;
  const changed =
    subject.kind === "job" || subject.entry.startDate !== range.startDate || subject.entry.endDate !== range.endDate || subject.entry.crewId !== crewId;
  return {
    ...range,
    crewId,
    workingDays: countWorkingDays(range.startDate, range.endDate, cal),
    conflict,
    valid: !inactive,
    reason: inactive ? "That crew isn't active any more" : null,
    changed,
  };
}

/** The plan for a keyboard-move draft (same checks as a drop). */
export function draftPlan(entry: EntryDTO, draft: KeyboardDraft, ctx: PlanContext): DropPlan {
  const crew = draft.crewId ? (ctx.crewsById.get(draft.crewId) ?? null) : null;
  const cal = ctx.calFor(crew);
  const self: EntryLike = { id: entry.id, crewId: draft.crewId, projectId: entry.projectId, kind: entry.kind, startDate: draft.startDate, endDate: draft.endDate };
  const inactive = !!draft.crewId && (!crew || !crew.active) && draft.crewId !== entry.crewId;
  return {
    startDate: draft.startDate,
    endDate: draft.endDate,
    crewId: draft.crewId,
    workingDays: countWorkingDays(draft.startDate, draft.endDate, cal),
    conflict: conflictsForEntry(self, [...ctx.entries], cal).dates.length > 0,
    valid: !inactive,
    reason: inactive ? "That crew isn't active any more" : null,
    changed: draft.startDate !== entry.startDate || draft.endDate !== entry.endDate || draft.crewId !== entry.crewId,
  };
}

export function previousWorkingDay(d: IsoDate, cal: WorkCalendar): IsoDate {
  for (let i = 1; i <= 60; i++) {
    const day = addDays(d, -i);
    if (isWorkingDay(day, cal)) return day;
  }
  return addDays(d, -1);
}

export interface KeyboardDraft extends DateRange {
  crewId: string | null;
}

export type KeyboardKey = "left" | "right" | "up" | "down";

/**
 * One keyboard step in move mode: ←/→ moves a working day (length kept), Shift resizes
 * the end, Alt the start, ↑/↓ changes the crew row (inactive crews are skipped).
 */
export function keyboardStep(
  cur: KeyboardDraft,
  key: KeyboardKey,
  mods: { shift: boolean; alt: boolean },
  ctx: { rows: readonly CrewRow[]; crewsById: ReadonlyMap<string, CrewDTO>; calFor: CalFor },
): KeyboardDraft {
  const crewOf = (id: string | null) => (id ? ctx.crewsById.get(id) : null);
  const cal = ctx.calFor(crewOf(cur.crewId));
  if (key === "up" || key === "down") {
    const rows = ctx.rows.filter((r) => r.droppable || r.crewId === cur.crewId);
    const i = rows.findIndex((r) => r.crewId === cur.crewId);
    const next = rows[Math.min(rows.length - 1, Math.max(0, (i < 0 ? 0 : i) + (key === "down" ? 1 : -1)))];
    if (!next || next.crewId === cur.crewId) return cur;
    return { ...applyMove(cur, 0, cal, ctx.calFor(crewOf(next.crewId))), crewId: next.crewId };
  }
  const dir = key === "right" ? 1 : -1;
  if (mods.shift) return { ...applyResize(cur, "end", dir), crewId: cur.crewId };
  if (mods.alt) return { ...applyResize(cur, "start", dir), crewId: cur.crewId };
  const target = dir > 0 ? nextWorkingDay(addDays(cur.startDate, 1), cal) : previousWorkingDay(cur.startDate, cal);
  return { ...applyMove(cur, diffDays(cur.startDate, target), cal, cal), crewId: cur.crewId };
}

// ---------------------------------------------------------------------------
// Agenda and month layout
// ---------------------------------------------------------------------------

export interface AgendaItem {
  entry: EntryDTO;
  dayNumber: number;
  totalDays: number;
}

export interface AgendaDay {
  date: IsoDate;
  closed: ClosedDay | null;
  items: AgendaItem[];
}

/**
 * The phone agenda: each day from `from` to `to` that has bookings or is a stat /
 * closed day. A booking is listed on its working days ("Day 2 of 5").
 */
export function agendaDays(
  entries: readonly EntryDTO[],
  from: IsoDate,
  to: IsoDate,
  closed: ReadonlyMap<IsoDate, ClosedDay>,
  calForEntry: (e: EntryDTO) => WorkCalendar,
): AgendaDay[] {
  const out: AgendaDay[] = [];
  const totals = new Map(entries.map((e) => [e.id, countWorkingDays(e.startDate, e.endDate, calForEntry(e))]));
  for (let i = 0, n = diffDays(from, to); i <= n; i++) {
    const date = addDays(from, i);
    const items: AgendaItem[] = [];
    for (const e of entries) {
      if (e.startDate > date || e.endDate < date) continue;
      const cal = calForEntry(e);
      const total = totals.get(e.id) ?? 0;
      if (total > 0 && !isWorkingDay(date, cal)) continue;
      items.push({ entry: e, dayNumber: total > 0 ? countWorkingDays(e.startDate, date, cal) : 1, totalDays: Math.max(1, total) });
    }
    const c = closed.get(date) ?? null;
    if (items.length || c) out.push({ date, closed: c, items });
  }
  return out;
}

export const MONTH_LANES = 4;

export interface MonthSegment {
  entry: EntryDTO;
  col: number;
  span: number;
  clipStart: boolean;
  clipEnd: boolean;
  lane: number;
}

export interface MonthWeek {
  days: IsoDate[];
  /** Lanes 0–3 (shown). */
  segments: MonthSegment[];
  /** Per column: bookings that didn't fit ("+2 more"). */
  hidden: number[];
}

/** Bars per week row of the month grid, stacked into lanes; the rest are counted per day. */
export function monthLayout(entries: readonly EntryDTO[], grid: IsoDate[][]): MonthWeek[] {
  return grid.map((days) => {
    const placed = entries
      .map((entry) => ({ entry, g: barGeometry(entry, { from: days[0], days: days.length }) }))
      .filter((x): x is { entry: EntryDTO; g: NonNullable<typeof x.g> } => !!x.g)
      .sort((a, b) => a.g.col - b.g.col || b.g.span - a.g.span || a.entry.projectNumber - b.entry.projectNumber);
    const laneEnds: number[] = [];
    const segments: MonthSegment[] = [];
    const hidden = days.map(() => 0);
    for (const { entry, g } of placed) {
      let lane = laneEnds.findIndex((end) => end < g.col);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = g.col + g.span - 1;
      if (lane < MONTH_LANES) segments.push({ entry, lane, ...g });
      else for (let c = g.col; c < g.col + g.span; c++) hidden[c]++;
    }
    return { days, segments, hidden };
  });
}

/** Bookings on one day (the "+n more" list). */
export function entriesOn(entries: readonly EntryDTO[], date: IsoDate): EntryDTO[] {
  return entries.filter((e) => e.startDate <= date && e.endDate >= date);
}

// ---------------------------------------------------------------------------
// Optimistic updates
// ---------------------------------------------------------------------------

export type EntryOp =
  | { type: "update"; id: string; patch: Partial<EntryDTO> }
  | { type: "create"; entry: EntryDTO }
  | { type: "delete"; id: string };

export function applyEntryOp(state: readonly EntryDTO[], op: EntryOp): EntryDTO[] {
  switch (op.type) {
    case "update":
      return state.map((e) => (e.id === op.id ? { ...e, ...op.patch } : e));
    case "create":
      return [...state.filter((e) => e.id !== op.entry.id), op.entry];
    case "delete":
      return state.filter((e) => e.id !== op.id);
  }
}

/** A stand-in bar shown while a new booking is being saved. */
export function draftEntry(
  id: string,
  job: Pick<UnscheduledJobDTO, "projectId" | "number" | "jobTitle" | "jobType" | "customerName" | "city" | "status">,
  b: { crewId: string | null; crewName: string | null; kind: ScheduleEntryKind; startDate: IsoDate; endDate: IsoDate; phaseLabel?: string | null },
): EntryDTO {
  return {
    id,
    version: 0,
    projectId: job.projectId,
    projectNumber: job.number,
    jobTitle: job.jobTitle,
    jobType: job.jobType,
    customerName: job.customerName,
    city: job.city,
    projectStatus: job.status,
    confirmation: "none",
    communicatedStart: null,
    crewId: b.crewId,
    crewName: b.crewName,
    kind: b.kind,
    phaseLabel: b.phaseLabel ?? null,
    startDate: b.startDate,
    endDate: b.endDate,
    plannedHours: null,
    notes: null,
    crewNotes: null,
  };
}

/** The job card fields of a booking (to rebuild a removed one, or add a phase). */
export function jobOf(e: EntryDTO): Pick<UnscheduledJobDTO, "projectId" | "number" | "jobTitle" | "jobType" | "customerName" | "city" | "status"> {
  return { projectId: e.projectId, number: e.projectNumber, jobTitle: e.jobTitle, jobType: e.jobType, customerName: e.customerName, city: e.city, status: e.projectStatus };
}

/**
 * Double-booking detection and lane stacking. Overlap is allowed (a split crew, a
 * sub with two teams) and only reported. Only working days count; bookings on
 * different crews never conflict, and the Unassigned row (crewId null) is ignored.
 */
import { addDays, diffDays, type IsoDate } from "@/lib/calendar-date";
import type { ScheduleEntryKind } from "./constants";
import { isWorkingDay, type WorkCalendar } from "./working-days";

export interface EntryLike {
  id: string;
  crewId: string | null;
  startDate: IsoDate;
  endDate: IsoDate;
  projectId: string;
  kind: ScheduleEntryKind;
}

export interface CrewConflict {
  crewId: string;
  date: IsoDate;
  entryIds: string[];
}

function workingDaysOf(e: { startDate: IsoDate; endDate: IsoDate }, cal: WorkCalendar, clip?: { from: IsoDate; to: IsoDate }): IsoDate[] {
  const from = clip && clip.from > e.startDate ? clip.from : e.startDate;
  const to = clip && clip.to < e.endDate ? clip.to : e.endDate;
  const out: IsoDate[] = [];
  for (let i = 0, n = diffDays(from, to); i <= n; i++) {
    const day = addDays(from, i);
    if (isWorkingDay(day, cal)) out.push(day);
  }
  return out;
}

const byDate = (a: { date: IsoDate }, b: { date: IsoDate }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function findCrewConflicts(entries: EntryLike[], calFor: (crewId: string) => WorkCalendar): CrewConflict[] {
  const perCrewDay = new Map<string, Map<IsoDate, string[]>>();
  for (const e of entries) {
    if (!e.crewId) continue;
    const days = perCrewDay.get(e.crewId) ?? new Map<IsoDate, string[]>();
    perCrewDay.set(e.crewId, days);
    for (const day of workingDaysOf(e, calFor(e.crewId))) days.set(day, [...(days.get(day) ?? []), e.id]);
  }
  const out: CrewConflict[] = [];
  for (const [crewId, days] of perCrewDay)
    for (const [date, ids] of days) if (new Set(ids).size > 1) out.push({ crewId, date, entryIds: [...new Set(ids)] });
  return out.sort((a, b) => byDate(a, b) || (a.crewId < b.crewId ? -1 : 1));
}

/** Working days on which `entry` overlaps another booking of the same crew, and which bookings. */
export function conflictsForEntry(entry: EntryLike, others: EntryLike[], cal: WorkCalendar): { dates: IsoDate[]; otherEntryIds: string[] } {
  if (!entry.crewId) return { dates: [], otherEntryIds: [] };
  const dates = new Set<IsoDate>();
  const ids = new Set<string>();
  for (const o of others) {
    if (o.id === entry.id || o.crewId !== entry.crewId || o.startDate > entry.endDate || o.endDate < entry.startDate) continue;
    const shared = workingDaysOf(entry, cal, { from: o.startDate, to: o.endDate });
    if (!shared.length) continue;
    ids.add(o.id);
    for (const day of shared) dates.add(day);
  }
  return { dates: [...dates].sort(), otherEntryIds: [...ids] };
}

/** People who belong to two crews that are both booked on the same working day. */
export function findPersonConflicts(
  entries: EntryLike[],
  membersByCrew: Map<string, string[]>,
  calFor: (crewId: string) => WorkCalendar,
): { userId: string; date: IsoDate; crewIds: string[] }[] {
  const crewsOnDay = new Map<IsoDate, Set<string>>();
  for (const e of entries) {
    if (!e.crewId) continue;
    for (const day of workingDaysOf(e, calFor(e.crewId))) {
      const set = crewsOnDay.get(day) ?? new Set<string>();
      set.add(e.crewId);
      crewsOnDay.set(day, set);
    }
  }
  const crewsOfUser = new Map<string, Set<string>>();
  for (const [crewId, users] of membersByCrew)
    for (const u of users) crewsOfUser.set(u, (crewsOfUser.get(u) ?? new Set<string>()).add(crewId));

  const out: { userId: string; date: IsoDate; crewIds: string[] }[] = [];
  for (const [userId, theirCrews] of crewsOfUser) {
    if (theirCrews.size < 2) continue;
    for (const [date, booked] of crewsOnDay) {
      const both = [...theirCrews].filter((c) => booked.has(c));
      if (both.length > 1) out.push({ userId, date, crewIds: both.sort() });
    }
  }
  return out.sort((a, b) => byDate(a, b) || (a.userId < b.userId ? -1 : 1));
}

/** Greedy interval partitioning per crew row (null = Unassigned): entry id → lane (0-based). */
export function assignLanes(entries: Pick<EntryLike, "id" | "crewId" | "startDate" | "endDate">[]): Map<string, number> {
  const lanes = new Map<string, number>();
  const rows = new Map<string | null, typeof entries>();
  for (const e of entries) rows.set(e.crewId, [...(rows.get(e.crewId) ?? []), e]);
  for (const row of rows.values()) {
    const sorted = [...row].sort((a, b) => (a.startDate !== b.startDate ? (a.startDate < b.startDate ? -1 : 1) : a.endDate !== b.endDate ? (a.endDate < b.endDate ? -1 : 1) : a.id < b.id ? -1 : 1));
    const laneEnds: IsoDate[] = [];
    for (const e of sorted) {
      let lane = laneEnds.findIndex((end) => end < e.startDate);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = e.endDate;
      lanes.set(e.id, lane);
    }
  }
  return lanes;
}

/** Number of lanes a crew row needs. */
export function laneCount(lanes: Map<string, number>, entryIds: string[]): number {
  return entryIds.reduce((max, id) => Math.max(max, (lanes.get(id) ?? 0) + 1), 1);
}

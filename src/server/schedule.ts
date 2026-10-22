import "server-only";
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/db/sql";
import {
  activities,
  crewMembers,
  crews,
  customers,
  estimates,
  projectScheduling,
  projects,
  properties,
  scheduleEntries,
  user,
  type ProjectStatus,
} from "@/db/schema";
import { addDays, diffDays, isoToInstant, todayIso, type IsoDate } from "@/lib/calendar-date";
import { needsUpdate } from "@/lib/schedule/confirmation";
import { MAX_BOOKING_SPAN_DAYS, type ScheduleEntryKind } from "@/lib/schedule/constants";
import { entryHours, PARTLY_SCHEDULED_MIN_HOURS, remainingHours, suggestedWorkingDays, type CrewCapacity } from "@/lib/schedule/duration";
import { conflictsForEntry } from "@/lib/schedule/conflicts";
import { dateRangeLabel, jobTitle } from "@/lib/schedule/format";
import { readinessSummary } from "@/lib/schedule/readiness";
import {
  createEntrySchema,
  deleteEntrySchema,
  projectIdSchema,
  removeProjectEntriesSchema,
  schedulingPrefsSchema,
  splitEntrySchema,
  updateEntrySchema,
  windowRangeSchema,
} from "@/lib/schedule/schemas";
import type { ScheduleSettings } from "@/lib/schedule/settings-schema";
import { planSplit } from "@/lib/schedule/split";
import { kindRefusal, planAutoStatus } from "@/lib/schedule/status-plan";
import type {
  CrewDTO,
  EntryChangeDTO,
  EntryDTO,
  FinishCandidateDTO,
  ProjectScheduleDTO,
  ProjectSchedulingDTO,
  ScheduleWarning,
  ScheduleWindowDTO,
  UnscheduledJobDTO,
} from "@/lib/schedule/types";
import { addWorkingDays, calendarsFor, countWorkingDays, isWorkingDay, nextWorkingDay, nonWorkingDaysIn, type WorkCalendar } from "@/lib/schedule/working-days";
import { d, Decimal, toDb } from "@/lib/money";
import { audit } from "./audit";
import { toCrewDTO } from "./crews";
import { changeProjectStatus, type Tx } from "./project-status";
import { getReadinessItems, getReadinessSummaries, syncLinkedReadiness } from "./readiness";
import { afterScheduleChange } from "./schedule-hooks";
import { defaultCapacity, getHoursPerCrewDay, getScheduleSettings } from "./schedule-settings";

/*
 * The only writer of schedule_entries (enforced by architecture.test.ts). Every
 * write runs in one transaction with the project row locked, keeps projects.start/
 * end_date and the readiness checks tied to booking kinds in step, moves
 * need_to_schedule ⇄ scheduled through changeProjectStatus, and ends at
 * afterScheduleChange (the Slack / Google Calendar seam).
 *
 * Reads select explicit columns and never touch contract or cost columns: every
 * DTO here goes to schedule.read users, who may lack financials.read. Callers check
 * schedule.read / schedule.write. Never cache these reads.
 */

export type ScheduleErrorReason = "stale" | "confirm_on_hold" | "not_found";

export class ScheduleError extends Error {
  readonly expose = true;
  /** For the UI: "confirm_on_hold" → ask, then retry with confirmOnHold: true; "stale" → refresh. */
  readonly reason: ScheduleErrorReason | undefined;
  constructor(message: string, reason?: ScheduleErrorReason) {
    super(message);
    this.name = "ScheduleError";
    this.reason = reason;
  }
}

export interface ScheduleActor {
  id: string;
}

export type { CrewDTO, EntryDTO, ScheduleWarning, UnscheduledJobDTO, ProjectSchedulingDTO };

const STALE = "Someone else changed this booking just now – the calendar has been refreshed.";
const GONE = "This booking was removed – the calendar has been refreshed.";
const SPAN = "Bookings can be at most 6 months long.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_STATUSES: ProjectStatus[] = ["need_to_schedule", "on_hold", "scheduled", "in_progress"];
const FINISHABLE: ProjectStatus[] = ["scheduled", "in_progress", "walk_through"];

type DbOrTx = Tx | typeof db;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const entryColumns = {
  id: scheduleEntries.id,
  version: scheduleEntries.version,
  projectId: scheduleEntries.projectId,
  projectNumber: projects.number,
  projectName: projects.name,
  estimateTitle: estimates.title,
  jobType: estimates.jobType,
  customerName: customers.displayName,
  city: properties.city,
  projectStatus: projects.status,
  confirmation: projectScheduling.confirmation,
  communicatedStart: projectScheduling.communicatedStart,
  crewId: scheduleEntries.crewId,
  crewName: crews.name,
  kind: scheduleEntries.kind,
  phaseLabel: scheduleEntries.phaseLabel,
  startDate: scheduleEntries.startDate,
  endDate: scheduleEntries.endDate,
  plannedHours: scheduleEntries.plannedHours,
  notes: scheduleEntries.notes,
  crewNotes: scheduleEntries.crewNotes,
  updatedAt: scheduleEntries.updatedAt,
  deletedAt: scheduleEntries.deletedAt,
};

function selectEntries(t: DbOrTx, where: SQL | undefined) {
  return t
    .select(entryColumns)
    .from(scheduleEntries)
    .innerJoin(projects, eq(projects.id, scheduleEntries.projectId))
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(properties, eq(properties.id, projects.propertyId))
    .leftJoin(estimates, eq(estimates.id, projects.estimateId))
    .leftJoin(projectScheduling, eq(projectScheduling.projectId, projects.id))
    .leftJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .where(where);
}

type EntryRow = Awaited<ReturnType<typeof selectEntries>>[number];

function toEntryDTO(r: EntryRow): EntryDTO {
  return {
    id: r.id,
    version: r.version,
    projectId: r.projectId,
    projectNumber: r.projectNumber ?? 0,
    jobTitle: jobTitle(r.projectName, r.estimateTitle),
    jobType: r.jobType ?? null,
    customerName: r.customerName,
    city: r.city ?? null,
    projectStatus: r.projectStatus,
    confirmation: r.confirmation ?? "none",
    communicatedStart: r.communicatedStart ?? null,
    crewId: r.crewId,
    crewName: r.crewName ?? null,
    kind: r.kind,
    phaseLabel: r.phaseLabel,
    startDate: r.startDate,
    endDate: r.endDate,
    plannedHours: r.plannedHours,
    notes: r.notes,
    crewNotes: r.crewNotes,
  };
}

async function loadEntry(id: string, t: DbOrTx = db): Promise<EntryDTO> {
  const [row] = await selectEntries(t, eq(scheduleEntries.id, id));
  if (!row) throw new ScheduleError(GONE, "not_found");
  return toEntryDTO(row);
}

const crewColumns = {
  id: crews.id,
  name: crews.name,
  kind: crews.kind,
  trade: crews.trade,
  subCompany: crews.subCompany,
  color: crews.color,
  crewSize: crews.crewSize,
  hoursPerDay: crews.hoursPerDay,
  worksSaturdays: crews.worksSaturdays,
  active: crews.active,
  sortOrder: crews.sortOrder,
  memberCount: sql<number>`(select count(*)::int from ${crewMembers} where ${crewMembers.crewId} = ${outer(crews.id)})`,
};

/** Bookings, crews and readiness for a calendar window (at most 62 days). Cancelled jobs are left out. */
export async function getScheduleWindow(range: { from: IsoDate; to: IsoDate }, opts: { crewIds?: string[] } = {}): Promise<ScheduleWindowDTO> {
  const r = windowRangeSchema.parse({ ...range, crewIds: opts.crewIds?.length ? opts.crewIds : undefined });
  const conds = [isNull(scheduleEntries.deletedAt), lte(scheduleEntries.startDate, r.to), gte(scheduleEntries.endDate, r.from), ne(projects.status, "cancelled")];
  if (r.crewIds) conds.push(inArray(scheduleEntries.crewId, r.crewIds));
  const [rows, settings] = await Promise.all([
    selectEntries(db, and(...conds)).orderBy(asc(scheduleEntries.startDate), asc(projects.number), asc(scheduleEntries.id)),
    getScheduleSettings(),
  ]);
  const entries = rows.map(toEntryDTO);
  const usedCrewIds = [...new Set(entries.map((e) => e.crewId).filter((id): id is string => !!id))];
  const crewWhere = r.crewIds ? inArray(crews.id, r.crewIds) : usedCrewIds.length ? or(eq(crews.active, true), inArray(crews.id, usedCrewIds)) : eq(crews.active, true);
  const [crewRows, readiness] = await Promise.all([
    db.select(crewColumns).from(crews).where(crewWhere).orderBy(asc(crews.sortOrder), asc(crews.name)),
    getReadinessSummaries(entries.map((e) => e.projectId), settings.readinessChecks),
  ]);
  return { entries, crews: crewRows.map(toCrewDTO), readiness };
}

interface WorkEntryHours {
  projectId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  plannedHours: string | null;
  crew: (CrewCapacity & { worksSaturdays: boolean }) | null;
}

async function workEntriesFor(t: DbOrTx, projectIds: string[]): Promise<WorkEntryHours[]> {
  if (!projectIds.length) return [];
  const rows = await t
    .select({
      projectId: scheduleEntries.projectId,
      startDate: scheduleEntries.startDate,
      endDate: scheduleEntries.endDate,
      plannedHours: scheduleEntries.plannedHours,
      crewSize: crews.crewSize,
      hoursPerDay: crews.hoursPerDay,
      worksSaturdays: crews.worksSaturdays,
    })
    .from(scheduleEntries)
    .leftJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .where(and(inArray(scheduleEntries.projectId, projectIds), eq(scheduleEntries.kind, "work"), isNull(scheduleEntries.deletedAt)));
  return rows.map((r) => ({
    projectId: r.projectId,
    startDate: r.startDate,
    endDate: r.endDate,
    plannedHours: r.plannedHours,
    crew: r.crewSize !== null && r.hoursPerDay !== null ? { crewSize: r.crewSize, hoursPerDay: r.hoursPerDay, worksSaturdays: !!r.worksSaturdays } : null,
  }));
}

/** Σ hours of work bookings by project (planned hours, else working days × crew capacity). */
function scheduledHoursByProject(entries: WorkEntryHours[], settings: ScheduleSettings, fallback: CrewCapacity): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  if (!entries.length) return out;
  const from = entries.reduce((m, e) => (e.startDate < m ? e.startDate : m), entries[0].startDate);
  const to = entries.reduce((m, e) => (e.endDate > m ? e.endDate : m), entries[0].endDate);
  const { calFor } = calendarsFor(settings, from, to);
  for (const e of entries) {
    const workingDays = countWorkingDays(e.startDate, e.endDate, calFor(e.crew));
    const h = entryHours({ plannedHours: e.plannedHours, workingDays }, e.crew, fallback);
    out.set(e.projectId, (out.get(e.projectId) ?? new Decimal(0)).plus(h));
  }
  return out;
}

const hoursText = (v: Decimal.Value) => toDb(v, 2);

/** The "To schedule" sidebar: need to schedule, partly scheduled (≥ 8 h left) and on hold. At most 200. */
export async function listUnscheduled(): Promise<UnscheduledJobDTO[]> {
  const [settings, hoursPerCrewDay] = await Promise.all([getScheduleSettings(), getHoursPerCrewDay()]);
  const fallback = defaultCapacity(settings, hoursPerCrewDay);
  const rows = await db
    .select({
      projectId: projects.id,
      number: projects.number,
      name: projects.name,
      estimateTitle: estimates.title,
      jobType: estimates.jobType,
      customerName: customers.displayName,
      city: properties.city,
      soldAt: projects.soldAt,
      status: projects.status,
      estimatedHours: projects.estimatedHours,
      notBefore: projectScheduling.notBefore,
    })
    .from(projects)
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(properties, eq(properties.id, projects.propertyId))
    .leftJoin(estimates, eq(estimates.id, projects.estimateId))
    .leftJoin(projectScheduling, eq(projectScheduling.projectId, projects.id))
    .where(inArray(projects.status, OPEN_STATUSES))
    .orderBy(asc(projects.soldAt), asc(projects.number))
    .limit(1000);

  const scheduled = scheduledHoursByProject(await workEntriesFor(db, rows.map((r) => r.projectId)), settings, fallback);
  const jobs: Omit<UnscheduledJobDTO, "readiness">[] = [];
  for (const r of rows) {
    const done = scheduled.get(r.projectId) ?? new Decimal(0);
    const left = remainingHours(r.estimatedHours, done);
    const group: UnscheduledJobDTO["group"] | null =
      r.status === "need_to_schedule" ? "need_to_schedule" : r.status === "on_hold" ? "on_hold" : left.gte(PARTLY_SCHEDULED_MIN_HOURS) ? "partly_scheduled" : null;
    if (!group) continue;
    jobs.push({
      projectId: r.projectId,
      number: r.number ?? 0,
      jobTitle: jobTitle(r.name, r.estimateTitle),
      customerName: r.customerName,
      city: r.city ?? null,
      jobType: r.jobType ?? null,
      soldAt: r.soldAt.toISOString(),
      status: r.status,
      estimatedHours: hoursText(r.estimatedHours),
      scheduledHours: hoursText(done),
      remainingHours: hoursText(left),
      notBefore: r.notBefore ?? null,
      group,
    });
  }
  const rank = { need_to_schedule: 0, partly_scheduled: 1, on_hold: 2 } as const;
  jobs.sort((a, b) => {
    if (a.group !== b.group) return rank[a.group] - rank[b.group];
    if (a.group === "on_hold" && a.notBefore !== b.notBefore) {
      if (!a.notBefore) return 1;
      if (!b.notBefore) return -1;
      return a.notBefore < b.notBefore ? -1 : 1;
    }
    return a.soldAt < b.soldAt ? -1 : a.soldAt > b.soldAt ? 1 : a.number - b.number;
  });
  const top = jobs.slice(0, 200);
  const summaries = await getReadinessSummaries(top.map((j) => j.projectId), settings.readinessChecks);
  return top.map((j) => {
    const s = summaries[j.projectId];
    return { ...j, readiness: { total: s?.total ?? 0, ready: s?.ready ?? 0, missing: s?.missing ?? [] } };
  });
}

function toSchedulingDTO(projectId: string, r: typeof projectScheduling.$inferSelect | undefined): ProjectSchedulingDTO {
  const iso = (v: Date | null | undefined) => (v ? v.toISOString() : null);
  return {
    projectId,
    confirmation: r?.confirmation ?? "none",
    noticeVariant: r?.noticeVariant ?? null,
    weekSentAt: iso(r?.weekSentAt),
    weekConfirmedAt: iso(r?.weekConfirmedAt),
    dateSentAt: iso(r?.dateSentAt),
    dateConfirmedAt: iso(r?.dateConfirmedAt),
    confirmedVia: r?.confirmedVia ?? null,
    communicatedStart: r?.communicatedStart ?? null,
    communicatedEnd: r?.communicatedEnd ?? null,
    notBefore: r?.notBefore ?? null,
    schedulingNotes: r?.schedulingNotes ?? null,
    version: r?.version ?? 0,
  };
}

async function loadScheduling(t: DbOrTx, projectId: string, forUpdate = false) {
  const q = t.select().from(projectScheduling).where(eq(projectScheduling.projectId, projectId));
  const [row] = forUpdate ? await q.for("update") : await q;
  return row;
}

/** Everything the project page's Schedule card needs. Null when the project doesn't exist. */
export async function getProjectSchedule(projectId: string): Promise<ProjectScheduleDTO | null> {
  if (!UUID_RE.test(projectId)) return null;
  const [p] = await db
    .select({ id: projects.id, number: projects.number, status: projects.status, estimatedHours: projects.estimatedHours })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!p) return null;
  const [rows, scheduling, readiness, settings, hoursPerCrewDay, work] = await Promise.all([
    selectEntries(db, and(eq(scheduleEntries.projectId, projectId), isNull(scheduleEntries.deletedAt))).orderBy(asc(scheduleEntries.startDate), asc(scheduleEntries.id)),
    loadScheduling(db, projectId),
    getReadinessItems(projectId),
    getScheduleSettings(),
    getHoursPerCrewDay(),
    workEntriesFor(db, [projectId]),
  ]);
  const scheduled = scheduledHoursByProject(work, settings, defaultCapacity(settings, hoursPerCrewDay)).get(projectId) ?? new Decimal(0);
  const workDays = work.map((w) => w.startDate).sort();
  const lastDays = work.map((w) => w.endDate).sort();
  return {
    projectId,
    projectNumber: p.number ?? 0,
    projectStatus: p.status,
    entries: rows.map(toEntryDTO),
    scheduling: toSchedulingDTO(projectId, scheduling),
    readiness,
    readinessSummary: readinessSummary(settings.readinessChecks, readiness.map((i) => ({ checkKey: i.key, state: i.state }))),
    hours: { estimated: hoursText(p.estimatedHours), scheduled: hoursText(scheduled) },
    firstWorkDay: workDays[0] ?? null,
    lastWorkDay: lastDays.at(-1) ?? null,
  };
}

/** Changes since `since`, deletions included, oldest first (the Google Calendar seam). */
export async function listEntryChangesSince(since: Date, limit = 500): Promise<EntryChangeDTO[]> {
  const n = Math.min(Math.max(1, Math.trunc(limit)), 2000);
  const rows = await selectEntries(db, gt(scheduleEntries.updatedAt, since)).orderBy(asc(scheduleEntries.updatedAt), asc(scheduleEntries.id)).limit(n);
  return rows.map((r) => ({ ...toEntryDTO(r), deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null, updatedAt: r.updatedAt.toISOString() }));
}

/**
 * Jobs that look finished on the calendar but aren't marked complete: the last work
 * booking ended two or more working days ago (feasibility review F15).
 */
export async function listFinishCandidates(now: Date = new Date()): Promise<FinishCandidateDTO[]> {
  const today = todayIso(now);
  const lastDay = sql<string>`max(${scheduleEntries.endDate})`;
  const rows = await db
    .select({
      projectId: projects.id,
      number: projects.number,
      name: projects.name,
      estimateTitle: estimates.title,
      customerName: customers.displayName,
      status: projects.status,
      lastWorkDay: lastDay,
    })
    .from(projects)
    .innerJoin(scheduleEntries, and(eq(scheduleEntries.projectId, projects.id), eq(scheduleEntries.kind, "work"), isNull(scheduleEntries.deletedAt)))
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(estimates, eq(estimates.id, projects.estimateId))
    .where(inArray(projects.status, FINISHABLE))
    .groupBy(projects.id, customers.displayName, estimates.title)
    .having(lt(lastDay, today))
    .orderBy(asc(lastDay))
    .limit(200);
  if (!rows.length) return [];
  const settings = await getScheduleSettings();
  const { calFor } = calendarsFor(settings, rows[0].lastWorkDay, today);
  const company = calFor(null);
  return rows
    .filter((r) => countWorkingDays(addDays(r.lastWorkDay, 1), today, company) >= 2)
    .map((r) => ({ projectId: r.projectId, number: r.number ?? 0, jobTitle: jobTitle(r.name, r.estimateTitle), customerName: r.customerName, status: r.status, lastWorkDay: r.lastWorkDay }));
}

// ---------------------------------------------------------------------------
// Writes (each ends with afterScheduleChange)
// ---------------------------------------------------------------------------

async function lockProject(t: Tx, projectId: string) {
  const [p] = await t
    .select({
      id: projects.id,
      number: projects.number,
      status: projects.status,
      estimatedHours: projects.estimatedHours,
      customerId: projects.customerId,
      opportunityId: projects.opportunityId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("update");
  if (!p) throw new ScheduleError("Project not found.", "not_found");
  return p;
}

type LockedProject = Awaited<ReturnType<typeof lockProject>>;

async function loadActiveCrew(t: DbOrTx, crewId: string) {
  const [crew] = await t
    .select({ id: crews.id, name: crews.name, active: crews.active, worksSaturdays: crews.worksSaturdays, crewSize: crews.crewSize, hoursPerDay: crews.hoursPerDay })
    .from(crews)
    .where(eq(crews.id, crewId));
  if (!crew || !crew.active) throw new ScheduleError("That crew is no longer active.");
  return crew;
}

async function lockEntry(t: Tx, id: string, version: number) {
  const [cur] = await t
    .select()
    .from(scheduleEntries)
    .where(and(eq(scheduleEntries.id, id), isNull(scheduleEntries.deletedAt)))
    .for("update");
  if (!cur) throw new ScheduleError(GONE, "stale");
  if (cur.version !== version) throw new ScheduleError(STALE, "stale");
  return cur;
}

/** Keeps projects.start/end_date on the first/last work day and auto-advances the status. */
async function syncProjectDates(t: Tx, p: LockedProject, actorId: string, opts: { confirmOnHold: boolean }) {
  const [agg] = await t
    .select({
      first: sql<string | null>`min(${scheduleEntries.startDate})`,
      last: sql<string | null>`max(${scheduleEntries.endDate})`,
      n: sql<number>`count(*)::int`,
    })
    .from(scheduleEntries)
    .where(and(eq(scheduleEntries.projectId, p.id), eq(scheduleEntries.kind, "work"), isNull(scheduleEntries.deletedAt)));
  await t
    .update(projects)
    .set({ startDate: agg?.first ? isoToInstant(agg.first) : null, endDate: agg?.last ? isoToInstant(agg.last) : null, updatedAt: new Date() })
    .where(eq(projects.id, p.id));
  const next = planAutoStatus(p.status, Number(agg?.n ?? 0), opts);
  if (next) await changeProjectStatus(p.id, next, { actorId, note: next === "scheduled" ? "Scheduled on the calendar" : "Removed from the calendar" }, t);
}

/** Readiness checks tied to a booking kind (pressure wash, colour consult) follow the project's bookings of that kind. */
async function syncReadiness(t: Tx, projectId: string, kinds: ScheduleEntryKind[], checks: ScheduleSettings["readinessChecks"], actorId: string) {
  const changedKinds = [...new Set(kinds)].filter((k) => checks.some((c) => c.linkedEntryKind === k));
  if (!changedKinds.length) return;
  const bookings = await t
    .select({ kind: scheduleEntries.kind, startDate: scheduleEntries.startDate })
    .from(scheduleEntries)
    .where(and(eq(scheduleEntries.projectId, projectId), inArray(scheduleEntries.kind, changedKinds), isNull(scheduleEntries.deletedAt)));
  await syncLinkedReadiness(t, { projectId, changedKinds, bookings, checks, actorId });
}

function assertSpan(start: IsoDate, end: IsoDate) {
  if (end < start) throw new ScheduleError("The end date is before the start date.");
  if (diffDays(start, end) > MAX_BOOKING_SPAN_DAYS) throw new ScheduleError(SPAN);
}

function workingDaysEnd(start: IsoDate, n: number, cal: WorkCalendar, allowNonWorkingStart: boolean): IsoDate {
  if (allowNonWorkingStart && !isWorkingDay(start, cal)) return n <= 1 ? start : addWorkingDays(addDays(start, 1), n - 1, cal);
  return addWorkingDays(start, n, cal);
}

async function logActivity(t: Tx, p: LockedProject, body: string, meta: Record<string, unknown>, actorId: string) {
  await t.insert(activities).values({ customerId: p.customerId, opportunityId: p.opportunityId, type: "system", body, meta, createdBy: actorId });
}

async function runHook(change: Parameters<typeof afterScheduleChange>[0]) {
  try {
    await afterScheduleChange(change);
  } catch (e) {
    console.error("[schedule] afterScheduleChange failed:", e instanceof Error ? e.name : "error");
  }
}

async function safeWarnings(entry: EntryDTO, opts: { datesChanged: boolean }): Promise<ScheduleWarning[]> {
  try {
    return await computeWarnings(entry, opts);
  } catch (e) {
    console.error("[schedule] warnings failed:", e instanceof Error ? e.name : "error");
    return [];
  }
}

/** Book a project onto a crew (or Unassigned). Callers check schedule.write. */
export async function createEntry(raw: unknown, actor: ScheduleActor): Promise<{ entry: EntryDTO; warnings: ScheduleWarning[] }> {
  const input = createEntrySchema.parse(raw);
  const [settings, hoursPerCrewDay] = await Promise.all([getScheduleSettings(), getHoursPerCrewDay()]);
  const crew = input.crewId ? await loadActiveCrew(db, input.crewId) : null;

  const { id, projectId } = await db.transaction(async (tx) => {
    const p = await lockProject(tx, input.projectId);
    const refusal = kindRefusal(p.status, input.kind);
    if (refusal) throw new ScheduleError(refusal);
    if (p.status === "on_hold" && input.kind === "work" && !input.confirmOnHold) throw new ScheduleError("This job is on hold. Confirm to schedule it.", "confirm_on_hold");

    let startDate = input.startDate;
    let endDate = input.endDate;
    if (!endDate) {
      const { calFor } = calendarsFor(settings, startDate, addDays(startDate, 400));
      const cal = calFor(crew);
      let days = input.workingDays;
      if (!days) {
        if (input.kind === "work") {
          const fallback = defaultCapacity(settings, hoursPerCrewDay);
          const done = scheduledHoursByProject(await workEntriesFor(tx, [p.id]), settings, fallback).get(p.id) ?? 0;
          days = suggestedWorkingDays(remainingHours(p.estimatedHours, done), crew ?? fallback);
        } else days = 1;
      }
      if (!input.allowNonWorkingStart) startDate = nextWorkingDay(startDate, cal);
      endDate = workingDaysEnd(startDate, days, cal, input.allowNonWorkingStart);
    }
    assertSpan(startDate, endDate);

    const [row] = await tx
      .insert(scheduleEntries)
      .values({
        projectId: p.id,
        crewId: crew?.id ?? null,
        kind: input.kind,
        phaseLabel: input.phaseLabel,
        startDate,
        endDate,
        notes: input.notes,
        crewNotes: input.crewNotes,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: scheduleEntries.id });
    await syncReadiness(tx, p.id, [input.kind], settings.readinessChecks, actor.id);
    await syncProjectDates(tx, p, actor.id, { confirmOnHold: input.confirmOnHold });
    await audit(
      { actorId: actor.id, action: "schedule.entry.create", entityType: "schedule_entry", entityId: row.id, after: { projectId: p.id, crewId: crew?.id ?? null, kind: input.kind, startDate, endDate } },
      tx,
    );
    if (input.kind === "work") {
      await logActivity(tx, p, `Scheduled${crew ? ` with ${crew.name}` : " (no crew yet)"}: ${dateRangeLabel(startDate, endDate)}`, { projectId: p.id, entryId: row.id }, actor.id);
    }
    return { id: row.id, projectId: p.id };
  });

  const entry = await loadEntry(id);
  const warnings = await safeWarnings(entry, { datesChanged: true });
  await runHook({ kind: "create", projectId, entryIds: [id], actorId: actor.id });
  return { entry, warnings };
}

const PATCHABLE = ["crewId", "kind", "startDate", "endDate", "phaseLabel", "notes", "crewNotes", "plannedHours"] as const;
type Patchable = (typeof PATCHABLE)[number];

/** Move, resize, reassign or edit a booking (version-checked). Callers check schedule.write. */
export async function updateEntry(raw: unknown, actor: ScheduleActor): Promise<{ entry: EntryDTO; warnings: ScheduleWarning[] }> {
  const input = updateEntrySchema.parse(raw);
  const settings = await getScheduleSettings();

  const { projectId, datesChanged, changed } = await db.transaction(async (tx) => {
    const cur = await lockEntry(tx, input.id, input.version);
    const p = await lockProject(tx, cur.projectId);
    const next: Pick<typeof cur, Patchable> = {
      crewId: input.crewId !== undefined ? input.crewId : cur.crewId,
      kind: input.kind ?? cur.kind,
      startDate: input.startDate ?? cur.startDate,
      endDate: input.endDate ?? cur.endDate,
      phaseLabel: input.phaseLabel !== undefined ? input.phaseLabel : cur.phaseLabel,
      notes: input.notes !== undefined ? input.notes : cur.notes,
      crewNotes: input.crewNotes !== undefined ? input.crewNotes : cur.crewNotes,
      plannedHours: input.plannedHours !== undefined ? input.plannedHours : cur.plannedHours,
    };
    const changed = PATCHABLE.filter((k) => (k === "plannedHours" ? !sameHours(next[k], cur[k]) : next[k] !== cur[k]));
    if (!changed.length) return { projectId: p.id, datesChanged: false, changed };
    assertSpan(next.startDate, next.endDate);
    const scheduleChanged = changed.some((k) => k === "kind" || k === "startDate" || k === "endDate" || k === "crewId");
    if (scheduleChanged) {
      const refusal = kindRefusal(p.status, next.kind);
      if (refusal) throw new ScheduleError(refusal);
    }
    if (next.crewId && next.crewId !== cur.crewId) await loadActiveCrew(tx, next.crewId);

    const [row] = await tx
      .update(scheduleEntries)
      .set({ ...next, version: sql`${scheduleEntries.version} + 1`, updatedAt: new Date(), updatedBy: actor.id })
      .where(and(eq(scheduleEntries.id, cur.id), eq(scheduleEntries.version, input.version), isNull(scheduleEntries.deletedAt)))
      .returning({ id: scheduleEntries.id });
    if (!row) throw new ScheduleError(STALE, "stale");

    const datesChanged = changed.some((k) => k === "kind" || k === "startDate" || k === "endDate");
    if (datesChanged) await syncProjectDates(tx, p, actor.id, { confirmOnHold: false });
    if (datesChanged) await syncReadiness(tx, p.id, [cur.kind, next.kind], settings.readinessChecks, actor.id);
    await audit(
      {
        actorId: actor.id,
        action: "schedule.entry.update",
        entityType: "schedule_entry",
        entityId: cur.id,
        before: Object.fromEntries(changed.map((k) => [k, cur[k]])),
        after: Object.fromEntries(changed.map((k) => [k, next[k]])),
      },
      tx,
    );
    return { projectId: p.id, datesChanged, changed };
  });

  const entry = await loadEntry(input.id);
  if (!changed.length) return { entry, warnings: [] };
  const warnings = await safeWarnings(entry, { datesChanged });
  await runHook({ kind: "update", projectId, entryIds: [input.id], actorId: actor.id });
  return { entry, warnings };
}

function sameHours(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return d(a).eq(d(b));
}

/** Soft-delete a booking (version-checked). Callers check schedule.write. */
export async function deleteEntry(raw: unknown, actor: ScheduleActor): Promise<{ projectId: string }> {
  const input = deleteEntrySchema.parse(raw);
  const settings = await getScheduleSettings();
  const projectId = await db.transaction(async (tx) => {
    const cur = await lockEntry(tx, input.id, input.version);
    const p = await lockProject(tx, cur.projectId);
    const now = new Date();
    const [row] = await tx
      .update(scheduleEntries)
      .set({ deletedAt: now, deletedBy: actor.id, version: sql`${scheduleEntries.version} + 1`, updatedAt: now, updatedBy: actor.id })
      .where(and(eq(scheduleEntries.id, cur.id), eq(scheduleEntries.version, input.version), isNull(scheduleEntries.deletedAt)))
      .returning({ id: scheduleEntries.id });
    if (!row) throw new ScheduleError(STALE, "stale");
    await syncProjectDates(tx, p, actor.id, { confirmOnHold: false });
    await syncReadiness(tx, p.id, [cur.kind], settings.readinessChecks, actor.id);
    await audit(
      {
        actorId: actor.id,
        action: "schedule.entry.delete",
        entityType: "schedule_entry",
        entityId: cur.id,
        before: { projectId: cur.projectId, crewId: cur.crewId, kind: cur.kind, startDate: cur.startDate, endDate: cur.endDate },
      },
      tx,
    );
    if (cur.kind === "work") {
      const crewName = cur.crewId ? (await tx.select({ name: crews.name }).from(crews).where(eq(crews.id, cur.crewId)))[0]?.name : null;
      await logActivity(tx, p, `Removed from the schedule: ${crewName ?? "no crew"}, ${dateRangeLabel(cur.startDate, cur.endDate)}`, { projectId: p.id, entryId: cur.id }, actor.id);
    }
    return p.id;
  });
  await runHook({ kind: "delete", projectId, entryIds: [input.id], actorId: actor.id });
  return { projectId };
}

/** Remove every booking of a project at once (e.g. a cancelled job). Callers check schedule.write. */
export async function removeProjectEntries(raw: unknown, actor: ScheduleActor): Promise<{ removed: number }> {
  const input = removeProjectEntriesSchema.parse(raw);
  const settings = await getScheduleSettings();
  const ids = await db.transaction(async (tx) => {
    const p = await lockProject(tx, input.projectId);
    const now = new Date();
    const rows = await tx
      .update(scheduleEntries)
      .set({ deletedAt: now, deletedBy: actor.id, version: sql`${scheduleEntries.version} + 1`, updatedAt: now, updatedBy: actor.id })
      .where(and(eq(scheduleEntries.projectId, p.id), isNull(scheduleEntries.deletedAt)))
      .returning({ id: scheduleEntries.id, kind: scheduleEntries.kind });
    if (!rows.length) return [];
    await syncProjectDates(tx, p, actor.id, { confirmOnHold: false });
    await syncReadiness(tx, p.id, rows.map((r) => r.kind), settings.readinessChecks, actor.id);
    await audit({ actorId: actor.id, action: "schedule.entry.delete_all", entityType: "project", entityId: p.id, before: { entryIds: rows.map((r) => r.id) } }, tx);
    await logActivity(tx, p, `Removed from the schedule (${rows.length} booking${rows.length === 1 ? "" : "s"})`, { projectId: p.id }, actor.id);
    return rows.map((r) => r.id);
  });
  if (ids.length) await runHook({ kind: "delete", projectId: input.projectId, entryIds: ids, actorId: actor.id });
  return { removed: ids.length };
}

/** Split a booking after `firstPartEnd` (a rain day). Planned hours are shared by working days. */
export async function splitEntry(raw: unknown, actor: ScheduleActor): Promise<{ entries: [EntryDTO, EntryDTO] }> {
  const input = splitEntrySchema.parse(raw);
  const settings = await getScheduleSettings();
  const { projectId, secondId } = await db.transaction(async (tx) => {
    const cur = await lockEntry(tx, input.id, input.version);
    const p = await lockProject(tx, cur.projectId);
    const refusal = kindRefusal(p.status, cur.kind);
    if (refusal) throw new ScheduleError(refusal);
    const crew = cur.crewId ? (await tx.select({ worksSaturdays: crews.worksSaturdays }).from(crews).where(eq(crews.id, cur.crewId)))[0] : null;
    const cal = calendarsFor(settings, cur.startDate, cur.endDate).calFor(crew);
    const plan = planSplit(cur, input.firstPartEnd, cal);
    if (!plan) throw new ScheduleError("Pick a day inside the booking, before its last day.");

    const now = new Date();
    const [row] = await tx
      .update(scheduleEntries)
      .set({ endDate: plan.first.endDate, plannedHours: plan.first.plannedHours, version: sql`${scheduleEntries.version} + 1`, updatedAt: now, updatedBy: actor.id })
      .where(and(eq(scheduleEntries.id, cur.id), eq(scheduleEntries.version, input.version), isNull(scheduleEntries.deletedAt)))
      .returning({ id: scheduleEntries.id });
    if (!row) throw new ScheduleError(STALE, "stale");
    const [second] = await tx
      .insert(scheduleEntries)
      .values({
        projectId: cur.projectId,
        crewId: cur.crewId,
        kind: cur.kind,
        phaseLabel: cur.phaseLabel,
        startDate: plan.second.startDate,
        endDate: plan.second.endDate,
        plannedHours: plan.second.plannedHours,
        notes: cur.notes,
        crewNotes: cur.crewNotes,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: scheduleEntries.id });
    await syncProjectDates(tx, p, actor.id, { confirmOnHold: false });
    await syncReadiness(tx, p.id, [cur.kind], settings.readinessChecks, actor.id);
    await audit(
      {
        actorId: actor.id,
        action: "schedule.entry.split",
        entityType: "schedule_entry",
        entityId: cur.id,
        before: { startDate: cur.startDate, endDate: cur.endDate, plannedHours: cur.plannedHours },
        after: { first: plan.first, second: { id: second.id, ...plan.second } },
      },
      tx,
    );
    return { projectId: p.id, secondId: second.id };
  });
  const entries: [EntryDTO, EntryDTO] = [await loadEntry(input.id), await loadEntry(secondId)];
  await runHook({ kind: "split", projectId, entryIds: [input.id, secondId], actorId: actor.id });
  return { entries };
}

/** "Not before" (e.g. next spring) and internal scheduling notes. Version 0 = no row yet. Callers check schedule.write. */
export async function saveSchedulingPrefs(raw: unknown, actor: ScheduleActor): Promise<ProjectSchedulingDTO> {
  const input = schedulingPrefsSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId));
    if (!p) throw new ScheduleError("Project not found.", "not_found");
    const cur = await loadScheduling(tx, input.projectId, true);
    const stale = new ScheduleError("Someone else changed these scheduling details just now – refresh and try again.", "stale");
    const values = { notBefore: input.notBefore, schedulingNotes: input.schedulingNotes, updatedBy: actor.id, updatedAt: new Date() };
    if (!cur) {
      if (input.version !== 0) throw stale;
      const inserted = await tx
        .insert(projectScheduling)
        .values({ projectId: input.projectId, ...values })
        .onConflictDoNothing()
        .returning({ projectId: projectScheduling.projectId });
      if (!inserted.length) throw stale;
    } else {
      if (cur.version !== input.version) throw stale;
      await tx
        .update(projectScheduling)
        .set({ ...values, version: sql`${projectScheduling.version} + 1` })
        .where(and(eq(projectScheduling.projectId, input.projectId), eq(projectScheduling.version, input.version)));
    }
    await audit(
      {
        actorId: actor.id,
        action: "schedule.prefs.save",
        entityType: "project",
        entityId: input.projectId,
        before: { notBefore: cur?.notBefore ?? null, schedulingNotes: cur?.schedulingNotes ?? null },
        after: { notBefore: input.notBefore, schedulingNotes: input.schedulingNotes },
      },
      tx,
    );
    return toSchedulingDTO(input.projectId, await loadScheduling(tx, input.projectId));
  });
}

/**
 * "Mark in progress" once the first work day has come. Callers check schedule.write
 * and projects.write. Never automatic.
 */
export async function markProjectInProgress(raw: unknown, actor: ScheduleActor): Promise<{ changed: boolean }> {
  const { projectId } = projectIdSchema.parse(typeof raw === "string" ? { projectId: raw } : raw);
  return db.transaction(async (tx) => {
    const p = await lockProject(tx, projectId);
    if (p.status !== "scheduled") throw new ScheduleError("Only a scheduled job can be marked in progress.");
    const [started] = await tx
      .select({ id: scheduleEntries.id })
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.projectId, p.id), eq(scheduleEntries.kind, "work"), isNull(scheduleEntries.deletedAt), lte(scheduleEntries.startDate, todayIso())))
      .limit(1);
    if (!started) throw new ScheduleError("The first work day hasn't come yet.");
    const r = await changeProjectStatus(p.id, "in_progress", { actorId: actor.id, note: "Work started" }, tx);
    return { changed: r.changed };
  });
}

/**
 * One click from the "Finished?" list: complete the job with the last work day as
 * its finish date. Callers check projects.write.
 */
export async function completeFromSchedule(raw: unknown, actor: ScheduleActor): Promise<{ changed: boolean; finishDate: IsoDate }> {
  const { projectId } = projectIdSchema.parse(typeof raw === "string" ? { projectId: raw } : raw);
  return db.transaction(async (tx) => {
    const p = await lockProject(tx, projectId);
    if (!FINISHABLE.includes(p.status)) throw new ScheduleError("This job isn't scheduled or in progress.");
    const [agg] = await tx
      .select({ last: sql<string | null>`max(${scheduleEntries.endDate})` })
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.projectId, p.id), eq(scheduleEntries.kind, "work"), isNull(scheduleEntries.deletedAt)));
    const last = agg?.last ?? null;
    if (!last) throw new ScheduleError("This job has no work booked.");
    if (last >= todayIso()) throw new ScheduleError("The last work day hasn't passed yet.");
    const r = await changeProjectStatus(p.id, "complete", { actorId: actor.id, effectiveDate: last, note: "Finished on the calendar" }, tx);
    return { changed: r.changed, finishDate: last };
  });
}

// ---------------------------------------------------------------------------
// Warnings (read-only, after commit)
// ---------------------------------------------------------------------------

/** Live warnings for one booking (the drawer). */
export async function getEntryWarnings(entryId: string): Promise<ScheduleWarning[]> {
  if (!UUID_RE.test(entryId)) return [];
  const [row] = await selectEntries(db, and(eq(scheduleEntries.id, entryId), isNull(scheduleEntries.deletedAt)));
  return row ? computeWarnings(toEntryDTO(row), { datesChanged: false }) : [];
}

function overlapping(crewIds: string[], e: { id: string; startDate: IsoDate; endDate: IsoDate }) {
  return and(
    inArray(scheduleEntries.crewId, crewIds),
    ne(scheduleEntries.id, e.id),
    isNull(scheduleEntries.deletedAt),
    lte(scheduleEntries.startDate, e.endDate),
    gte(scheduleEntries.endDate, e.startDate),
    ne(projects.status, "cancelled"),
  );
}

async function computeWarnings(entry: EntryDTO, opts: { datesChanged: boolean }): Promise<ScheduleWarning[]> {
  const settings = await getScheduleSettings();
  const today = todayIso();
  const { calFor } = calendarsFor(settings, entry.startDate, entry.endDate);
  const crew = entry.crewId ? (await db.select({ worksSaturdays: crews.worksSaturdays }).from(crews).where(eq(crews.id, entry.crewId)))[0] : null;
  const cal = calFor(crew);
  const warnings: ScheduleWarning[] = [];

  if (entry.crewId) {
    const others = await db
      .select({ id: scheduleEntries.id, crewId: scheduleEntries.crewId, startDate: scheduleEntries.startDate, endDate: scheduleEntries.endDate, projectId: scheduleEntries.projectId, kind: scheduleEntries.kind, projectNumber: projects.number })
      .from(scheduleEntries)
      .innerJoin(projects, eq(projects.id, scheduleEntries.projectId))
      .where(overlapping([entry.crewId], entry));
    const c = conflictsForEntry(entry, others, cal);
    if (c.dates.length) {
      const numbers = [...new Set(others.filter((o) => c.otherEntryIds.includes(o.id)).map((o) => o.projectNumber ?? 0))].sort((a, b) => a - b);
      warnings.push({ type: "double_booked", crewName: entry.crewName ?? "", dates: c.dates, otherProjectNumbers: numbers });
    }
    warnings.push(...(await personConflicts(entry, cal)));
  }

  const off = nonWorkingDaysIn(entry.startDate, entry.endDate, cal);
  if (off.length) warnings.push({ type: "non_working", days: off });

  if (entry.kind === "work") {
    const summary = (await getReadinessSummaries([entry.projectId], settings.readinessChecks))[entry.projectId];
    if (summary?.missing.length) warnings.push({ type: "not_ready", missing: summary.missing });
  }
  const scheduling = await loadScheduling(db, entry.projectId);
  if (scheduling?.notBefore && entry.startDate < scheduling.notBefore) warnings.push({ type: "before_not_before", notBefore: scheduling.notBefore });
  if (opts.datesChanged && entry.startDate < today) warnings.push({ type: "in_past" });

  if (entry.kind === "work" && scheduling?.communicatedStart) {
    const [agg] = await db
      .select({ first: sql<string | null>`min(${scheduleEntries.startDate})` })
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.projectId, entry.projectId), eq(scheduleEntries.kind, "work"), isNull(scheduleEntries.deletedAt)));
    const first = agg?.first ?? null;
    if (first && needsUpdate({ confirmation: scheduling.confirmation, communicatedStart: scheduling.communicatedStart }, first)) {
      warnings.push({ type: "customer_told", communicatedStart: scheduling.communicatedStart, newStart: first });
    }
  }
  return warnings;
}

/** Members of this booking's crew who are also in another crew booked on the same working days. */
async function personConflicts(entry: EntryDTO, cal: WorkCalendar): Promise<ScheduleWarning[]> {
  if (!entry.crewId) return [];
  const members = await db
    .select({ userId: crewMembers.userId, name: user.name })
    .from(crewMembers)
    .innerJoin(user, eq(user.id, crewMembers.userId))
    .where(eq(crewMembers.crewId, entry.crewId));
  if (!members.length) return [];
  const otherMemberships = await db
    .select({ userId: crewMembers.userId, crewId: crewMembers.crewId })
    .from(crewMembers)
    .innerJoin(crews, eq(crews.id, crewMembers.crewId))
    .where(and(inArray(crewMembers.userId, members.map((m) => m.userId)), ne(crewMembers.crewId, entry.crewId), eq(crews.active, true)));
  if (!otherMemberships.length) return [];
  const otherEntries = await db
    .select({ crewId: scheduleEntries.crewId, startDate: scheduleEntries.startDate, endDate: scheduleEntries.endDate })
    .from(scheduleEntries)
    .innerJoin(projects, eq(projects.id, scheduleEntries.projectId))
    .where(overlapping([...new Set(otherMemberships.map((m) => m.crewId))], entry));
  const out: ScheduleWarning[] = [];
  for (const m of members) {
    const theirCrews = new Set(otherMemberships.filter((o) => o.userId === m.userId).map((o) => o.crewId));
    const dates = new Set<IsoDate>();
    for (const o of otherEntries) {
      if (!o.crewId || !theirCrews.has(o.crewId)) continue;
      const from = o.startDate > entry.startDate ? o.startDate : entry.startDate;
      const to = o.endDate < entry.endDate ? o.endDate : entry.endDate;
      for (let i = 0, n = diffDays(from, to); i <= n; i++) {
        const day = addDays(from, i);
        if (isWorkingDay(day, cal)) dates.add(day);
      }
    }
    if (dates.size) out.push({ type: "person_double_booked", userName: m.name, dates: [...dates].sort() });
  }
  return out;
}


import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, PROJECT_STATUSES, projects, projectStatusEvents, user, type ProjectStatus, type StatusEventSource } from "@/db/schema";
import { PROJECT_STATUS_LABEL } from "@/app/(app)/projects/status";
import { businessDate, formatIsoDate, isIsoDate, isoToInstant, todayIso, type IsoDate } from "@/lib/calendar-date";
import { audit } from "./audit";

/*
 * The only writer of projects.status (enforced by architecture.test.ts). Every
 * change also keeps sold/completed/cancelled timestamps and the status history
 * consistent, which the dashboard's Sales, Produced and Backlog depend on.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const DONE_STATUSES = ["complete", "invoiced", "closed"] as const satisfies readonly ProjectStatus[];
export const INITIAL_PROJECT_STATUS: ProjectStatus = "need_to_schedule";
export const STATUS_NOTE_MAX = 500;

export function isDoneStatus(s: ProjectStatus | string): boolean {
  return (DONE_STATUSES as readonly string[]).includes(s);
}

export class ProjectStatusError extends Error {
  readonly expose = true;
}

export interface ProjectStatusState {
  status: ProjectStatus;
  soldAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

export interface StatusPlan {
  set: { status: ProjectStatus; completedAt?: Date | null; cancelledAt?: Date | null; updatedAt: Date };
  effectiveAt: Date;
  /** A finished job moved back to an unfinished status: it no longer counts as produced. */
  reopened: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const label = (s: ProjectStatus) => PROJECT_STATUS_LABEL[s] ?? s;

/**
 * The instant a change chosen for a Vancouver day takes effect: now for today,
 * local noon for a past day (so it lands in the right month whatever the DST),
 * never before the sale.
 */
export function effectiveInstant(p: { soldAt: Date }, date: IsoDate | null | undefined, now: Date, what = "Date"): Date {
  if (date === null || date === undefined) return now;
  if (!isIsoDate(date)) throw new ProjectStatusError(`${what} isn't a valid date.`);
  const today = todayIso(now);
  if (date > today) throw new ProjectStatusError(`${what} can't be in the future.`);
  const sold = businessDate(p.soldAt);
  if (date < sold) throw new ProjectStatusError(`${what} can't be before the job was sold (${formatIsoDate(sold)}).`);
  if (date === today) return now;
  const noon = isoToInstant(date, "12:00");
  return noon < p.soldAt ? p.soldAt : noon;
}

/** Pure: what to write for a status change, or null when nothing changes. Throws ProjectStatusError for invalid changes. */
export function planStatusChange(
  p: ProjectStatusState,
  to: ProjectStatus,
  opts: { date?: IsoDate | null; note?: string | null },
  now: Date,
): StatusPlan | null {
  if (!(PROJECT_STATUSES as readonly string[]).includes(to)) throw new ProjectStatusError("Unknown project status.");
  if (p.status === to) return null;
  const note = opts.note?.trim() || null;
  if (note && note.length > STATUS_NOTE_MAX) throw new ProjectStatusError(`Keep the note under ${STATUS_NOTE_MAX} characters.`);

  const intoDone = isDoneStatus(to);
  const wasFinished = isDoneStatus(p.status) || p.completedAt !== null;
  const effectiveAt = effectiveInstant(p, opts.date, now, intoDone ? "Finish date" : to === "cancelled" ? "Cancellation date" : "Date");
  const set: StatusPlan["set"] = { status: to, updatedAt: now };
  let reopened = false;

  if (to === "cancelled") {
    if (wasFinished) throw new ProjectStatusError("This job is marked as finished. Reopen it first if it wasn't actually finished.");
    if (!note) throw new ProjectStatusError("Enter a reason for cancelling.");
    set.cancelledAt = effectiveAt;
    return { set, effectiveAt, reopened };
  }
  if (p.status === "cancelled" || p.cancelledAt !== null) set.cancelledAt = null;
  if (intoDone) {
    // Moving between finished statuses (complete → invoiced) keeps the finish date.
    if (p.completedAt === null) set.completedAt = effectiveAt;
  } else if (wasFinished) {
    set.completedAt = null;
    reopened = true;
  }
  return { set, effectiveAt, reopened };
}

async function lockProject(t: Tx, projectId: string) {
  if (!UUID_RE.test(projectId)) throw new ProjectStatusError("Project not found.");
  const [p] = await t
    .select({
      id: projects.id,
      number: projects.number,
      status: projects.status,
      soldAt: projects.soldAt,
      completedAt: projects.completedAt,
      cancelledAt: projects.cancelledAt,
      customerId: projects.customerId,
      opportunityId: projects.opportunityId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("update");
  if (!p) throw new ProjectStatusError("Project not found.");
  return p;
}

const inTx = <T>(tx: Tx | undefined, run: (t: Tx) => Promise<T>): Promise<T> => (tx ? run(tx) : db.transaction(run));
const dayLabel = (at: Date) => formatIsoDate(businessDate(at));

export interface StatusChangeInput {
  actorId: string | null;
  /** Vancouver day the change took effect; omitted = now. */
  effectiveDate?: IsoDate | null;
  /** Required when cancelling. */
  note?: string | null;
  source?: Exclude<StatusEventSource, "backfill">;
}

export interface StatusChangeResult {
  changed: boolean;
  status: ProjectStatus;
  completedAt: Date | null;
  cancelledAt: Date | null;
  reopened: boolean;
}

/**
 * Change a project's status. Pass `tx` to make it part of a larger transaction
 * (it then opens no transaction of its own); otherwise it runs in its own.
 */
export async function changeProjectStatus(projectId: string, to: ProjectStatus, input: StatusChangeInput, tx?: Tx): Promise<StatusChangeResult> {
  return inTx(tx, async (t) => {
    const p = await lockProject(t, projectId);
    const now = new Date();
    const note = input.note?.trim() || null;
    const plan = planStatusChange(p, to, { date: input.effectiveDate, note }, now);
    if (!plan) return { changed: false, status: p.status, completedAt: p.completedAt, cancelledAt: p.cancelledAt, reopened: false };

    const after = {
      status: to,
      completedAt: plan.set.completedAt === undefined ? p.completedAt : plan.set.completedAt,
      cancelledAt: plan.set.cancelledAt === undefined ? p.cancelledAt : plan.set.cancelledAt,
    };
    await t.update(projects).set(plan.set).where(eq(projects.id, p.id));
    await t.insert(projectStatusEvents).values({
      projectId: p.id,
      fromStatus: p.status,
      toStatus: to,
      effectiveAt: plan.effectiveAt,
      changedAt: now,
      changedBy: input.actorId,
      source: input.source ?? "app",
      note,
    });
    await audit(
      {
        actorId: input.actorId,
        action: "project.status",
        entityType: "project",
        entityId: p.id,
        before: { status: p.status, completedAt: p.completedAt, cancelledAt: p.cancelledAt },
        after,
      },
      t,
    );
    const ref = p.number ? `Project #${p.number}` : "Project";
    const detail = [
      plan.set.completedAt ? `finished ${dayLabel(plan.set.completedAt)}` : null,
      plan.set.cancelledAt ? `cancelled ${dayLabel(plan.set.cancelledAt)}` : null,
      plan.reopened ? "reopened, no longer counted as produced" : null,
    ].filter(Boolean);
    await t.insert(activities).values({
      customerId: p.customerId,
      opportunityId: p.opportunityId,
      type: "system",
      body: `${ref} moved from ${label(p.status)} to ${label(to)}${detail.length ? ` (${detail.join("; ")})` : ""}${note ? `. Note: ${note}` : ""}`,
      meta: { projectId: p.id, from: p.status, to },
      createdBy: input.actorId,
    });
    return { changed: true, ...after, reopened: plan.reopened };
  });
}

/** Correct the finish date of a finished job. */
export async function setCompletionDate(projectId: string, date: IsoDate, actorId: string | null, tx?: Tx): Promise<{ changed: boolean; completedAt: Date }> {
  return inTx(tx, async (t) => {
    const p = await lockProject(t, projectId);
    if (!isDoneStatus(p.status)) throw new ProjectStatusError("Only a finished job has a finish date.");
    const now = new Date();
    const at = effectiveInstant(p, date, now, "Finish date");
    if (p.completedAt && businessDate(p.completedAt) === date) return { changed: false, completedAt: p.completedAt };

    await t.update(projects).set({ completedAt: at, updatedAt: now }).where(eq(projects.id, p.id));
    await t.insert(projectStatusEvents).values({
      projectId: p.id,
      fromStatus: p.status,
      toStatus: p.status,
      effectiveAt: at,
      changedAt: now,
      changedBy: actorId,
      source: "app",
      note: "Finish date changed",
    });
    await audit({ actorId, action: "project.completion_date", entityType: "project", entityId: p.id, before: { completedAt: p.completedAt }, after: { completedAt: at } }, t);
    return { changed: true, completedAt: at };
  });
}

export type SoldProjectValues = Omit<
  typeof projects.$inferInsert,
  "id" | "number" | "status" | "soldAt" | "completedAt" | "cancelledAt" | "createdAt" | "updatedAt"
>;

/**
 * Create the project for a sale (a signed proposal). It starts in
 * need_to_schedule, sold at the signing time, with its first history event.
 * Returns null when the estimate already has a project.
 */
export async function createSoldProject(
  values: SoldProjectValues,
  opts: { soldAt: Date; actorId: string | null; note?: string | null; source?: Exclude<StatusEventSource, "backfill"> },
  tx?: Tx,
) {
  return inTx(tx, async (t) => {
    const [project] = await t
      .insert(projects)
      .values({ ...values, status: INITIAL_PROJECT_STATUS, soldAt: opts.soldAt })
      .onConflictDoNothing({ target: projects.estimateId })
      .returning();
    if (!project) return null;
    await t.insert(projectStatusEvents).values({
      projectId: project.id,
      fromStatus: null,
      toStatus: project.status,
      effectiveAt: opts.soldAt,
      changedBy: opts.actorId,
      source: opts.source ?? "app",
      note: opts.note ?? null,
    });
    return project;
  });
}

export interface StatusEventRow {
  id: string;
  fromStatus: ProjectStatus | null;
  toStatus: ProjectStatus;
  effectiveAt: Date;
  changedAt: Date;
  changedByName: string | null;
  source: StatusEventSource;
  note: string | null;
}

/** Most recent status history first. */
export async function listStatusEvents(projectId: string, limit = 10): Promise<StatusEventRow[]> {
  if (!UUID_RE.test(projectId)) return [];
  return db
    .select({
      id: projectStatusEvents.id,
      fromStatus: projectStatusEvents.fromStatus,
      toStatus: projectStatusEvents.toStatus,
      effectiveAt: projectStatusEvents.effectiveAt,
      changedAt: projectStatusEvents.changedAt,
      changedByName: user.name,
      source: projectStatusEvents.source,
      note: projectStatusEvents.note,
    })
    .from(projectStatusEvents)
    .leftJoin(user, eq(user.id, projectStatusEvents.changedBy))
    .where(eq(projectStatusEvents.projectId, projectId))
    .orderBy(desc(projectStatusEvents.changedAt), desc(projectStatusEvents.id))
    .limit(Math.min(Math.max(1, Math.trunc(limit)), 100));
}

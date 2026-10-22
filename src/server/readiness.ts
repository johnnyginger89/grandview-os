import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectReadiness, projects, scheduleEntries, type ReadinessState, type ScheduleEntryKind } from "@/db/schema";
import { todayIso, type IsoDate } from "@/lib/calendar-date";
import {
  DONE_WHEN_BOOKING_PASSES,
  linkedReadinessChanges,
  readinessItems,
  readinessSummary,
  type LinkedBooking,
  type ReadinessContext,
  type ReadinessItem,
  type ReadinessSummary,
} from "@/lib/schedule/readiness";
import { readinessSchema } from "@/lib/schedule/schemas";
import type { ReadinessCheck } from "@/lib/schedule/settings-schema";
import { audit } from "./audit";
import type { Tx } from "./project-status";
import { getScheduleSettings } from "./schedule-settings";

export class ReadinessError extends Error {
  readonly expose = true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rowsFor(projectIds: string[], t: Tx | typeof db = db) {
  if (!projectIds.length) return [];
  return t
    .select({
      projectId: projectReadiness.projectId,
      checkKey: projectReadiness.checkKey,
      state: projectReadiness.state,
      dueDate: projectReadiness.dueDate,
      note: projectReadiness.note,
    })
    .from(projectReadiness)
    .where(inArray(projectReadiness.projectId, projectIds));
}

/** By project, the last booked day of each kind that is over once its bookings have passed (a pressure wash). */
async function bookedThrough(projectIds: string[]): Promise<Map<string, ReadinessContext["bookedThrough"]>> {
  const out = new Map<string, ReadinessContext["bookedThrough"]>();
  if (!projectIds.length) return out;
  const rows = await db
    .select({ projectId: scheduleEntries.projectId, kind: scheduleEntries.kind, last: sql<IsoDate>`max(${scheduleEntries.endDate})` })
    .from(scheduleEntries)
    .where(and(inArray(scheduleEntries.projectId, projectIds), inArray(scheduleEntries.kind, [...DONE_WHEN_BOOKING_PASSES]), isNull(scheduleEntries.deletedAt)))
    .groupBy(scheduleEntries.projectId, scheduleEntries.kind);
  for (const r of rows) out.set(r.projectId, { ...out.get(r.projectId), [r.kind]: r.last });
  return out;
}

/** The project's checklist: current settings' checks merged with saved answers (missing = todo), as of today. */
export async function getReadinessItems(projectId: string): Promise<ReadinessItem[]> {
  if (!UUID_RE.test(projectId)) return [];
  const [settings, rows, booked] = await Promise.all([getScheduleSettings(), rowsFor([projectId]), bookedThrough([projectId])]);
  return readinessItems(settings.readinessChecks, rows, { today: todayIso(), bookedThrough: booked.get(projectId) ?? {} });
}

/** Summaries by project id, for the calendar and the sidebar, as of today. */
export async function getReadinessSummaries(projectIds: string[], checks: readonly ReadinessCheck[]): Promise<Record<string, ReadinessSummary>> {
  const ids = [...new Set(projectIds)].filter((id) => UUID_RE.test(id));
  const [rows, booked] = await Promise.all([rowsFor(ids), bookedThrough(ids)]);
  const today = todayIso();
  const byProject = new Map<string, { checkKey: string; state: ReadinessState }[]>();
  for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  return Object.fromEntries(ids.map((id) => [id, readinessSummary(checks, byProject.get(id) ?? [], { today, bookedThrough: booked.get(id) ?? {} })]));
}

/** Callers check schedule.write. The check must exist in the current settings. */
export async function setReadinessItem(raw: unknown, actor: { id: string }): Promise<ReadinessItem> {
  const input = readinessSchema.parse(raw);
  const settings = await getScheduleSettings();
  const check = settings.readinessChecks.find((c) => c.key === input.checkKey);
  if (!check) throw new ReadinessError("That readiness check no longer exists. Refresh the page.");

  return db.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId));
    if (!project) throw new ReadinessError("Project not found.");
    const [before] = await tx
      .select({ state: projectReadiness.state, dueDate: projectReadiness.dueDate, note: projectReadiness.note })
      .from(projectReadiness)
      .where(and(eq(projectReadiness.projectId, input.projectId), eq(projectReadiness.checkKey, input.checkKey)));
    const values = {
      state: input.state,
      dueDate: input.dueDate === undefined ? (before?.dueDate ?? null) : input.dueDate,
      note: input.note === undefined ? (before?.note ?? null) : input.note,
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    await tx
      .insert(projectReadiness)
      .values({ projectId: input.projectId, checkKey: input.checkKey, ...values })
      .onConflictDoUpdate({ target: [projectReadiness.projectId, projectReadiness.checkKey], set: values });
    await audit(
      {
        actorId: actor.id,
        action: "schedule.readiness.set",
        entityType: "project",
        entityId: input.projectId,
        before: { checkKey: input.checkKey, ...(before ?? { state: "todo", dueDate: null, note: null }) },
        after: { checkKey: input.checkKey, state: values.state, dueDate: values.dueDate, note: values.note },
      },
      tx,
    );
    return readinessItems([check], [{ checkKey: check.key, state: values.state, dueDate: values.dueDate, note: values.note }])[0];
  });
}

/**
 * Inside every booking transaction (schedule.ts passes the project's current bookings of
 * the kinds that changed): the checks linked to those kinds follow the calendar, see
 * linkedReadinessChanges. Internal only.
 */
export async function syncLinkedReadiness(
  tx: Tx,
  input: { projectId: string; changedKinds: readonly ScheduleEntryKind[]; bookings: readonly LinkedBooking[]; checks: readonly ReadinessCheck[]; actorId: string },
): Promise<void> {
  if (!input.checks.some((c) => c.linkedEntryKind && input.changedKinds.includes(c.linkedEntryKind))) return;
  const rows = await rowsFor([input.projectId], tx);
  for (const change of linkedReadinessChanges(input.checks, rows, input.bookings, input.changedKinds)) {
    const values = { state: change.state, dueDate: change.dueDate, updatedBy: input.actorId, updatedAt: new Date() };
    await tx
      .insert(projectReadiness)
      .values({ projectId: input.projectId, checkKey: change.checkKey, ...values })
      .onConflictDoUpdate({ target: [projectReadiness.projectId, projectReadiness.checkKey], set: values });
    await audit(
      {
        actorId: input.actorId,
        action: "schedule.readiness.linked",
        entityType: "project",
        entityId: input.projectId,
        before: { checkKey: change.checkKey, ...change.before },
        after: { checkKey: change.checkKey, state: change.state, dueDate: change.dueDate },
      },
      tx,
    );
  }
}

/**
 * Inside the colour-form signing transaction: the readiness checks tied to colour consults
 * (normally "Colour consult") are ticked off as done, unless marked not needed. Internal only.
 */
export async function markColoursChosen(tx: Tx, input: { projectId: string; checks: readonly ReadinessCheck[]; actorId: string | null; note: string }): Promise<string[]> {
  const keys = input.checks.filter((c) => c.linkedEntryKind === "colour_consult").map((c) => c.key);
  if (!keys.length) return [];
  const rows = await rowsFor([input.projectId], tx);
  const changed: string[] = [];
  for (const key of keys) {
    const row = rows.find((r) => r.checkKey === key);
    if (row && (row.state === "done" || row.state === "not_needed")) continue;
    await tx
      .insert(projectReadiness)
      .values({ projectId: input.projectId, checkKey: key, state: "done", note: input.note, updatedBy: input.actorId })
      .onConflictDoUpdate({
        target: [projectReadiness.projectId, projectReadiness.checkKey],
        set: { state: "done", note: input.note, updatedBy: input.actorId, updatedAt: new Date() },
      });
    changed.push(key);
  }
  return changed;
}

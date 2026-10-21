"use server";
import { refresh, revalidatePath } from "next/cache";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission, AuthorizationError } from "@/lib/authz/guard";
import { can, type Permission } from "@/lib/authz/permissions";
import type { IsoDate } from "@/lib/calendar-date";
import {
  confirmSchema,
  createEntrySchema,
  deleteEntrySchema,
  noticePreviewSchema,
  noticeSendSchema,
  projectIdSchema,
  readinessSchema,
  schedulingPrefsSchema,
  splitEntrySchema,
  updateEntrySchema,
} from "@/lib/schedule/schemas";
import type { EntryDTO, NoticePreview, ProjectSchedulingDTO, ReadinessItem, ScheduleWarning } from "@/lib/schedule/types";
import { setReadinessItem } from "@/server/readiness";
import {
  completeFromSchedule,
  createEntry,
  deleteEntry,
  markProjectInProgress,
  saveSchedulingPrefs,
  ScheduleError,
  splitEntry,
  updateEntry,
  type ScheduleErrorReason,
} from "@/server/schedule";
import { composeStartNotice, markStartConfirmed, sendStartNotice } from "@/server/start-notices";

/*
 * Thin wrappers: check permission, parse with zod, call the service, revalidate.
 * They never throw to the client. "stale" / "not_found" failures also refresh the
 * page in the same response, so the calendar shows what is really saved.
 */

export type ActionFail = { ok: false; error: string; reason?: ScheduleErrorReason };
export type EntryActionResult = { ok: true; entry: EntryDTO; warnings: ScheduleWarning[] } | ActionFail;
export type SplitActionResult = { ok: true; entries: [EntryDTO, EntryDTO] } | ActionFail;
export type OkResult = { ok: true; message?: string } | ActionFail;
export type ReadinessActionResult = { ok: true; item: ReadinessItem } | ActionFail;
export type PrefsActionResult = { ok: true; scheduling: ProjectSchedulingDTO } | ActionFail;
export type CompleteActionResult = { ok: true; finishDate: IsoDate } | ActionFail;
/** The dialog's view of the preview (no template key). */
export type NoticePreviewView = Omit<NoticePreview, "templateKey">;
export type PreviewActionResult = { ok: true; preview: NoticePreviewView } | ActionFail;

function fail(e: unknown): ActionFail {
  const reason = e instanceof ScheduleError ? e.reason : undefined;
  if (reason === "stale" || reason === "not_found") refresh();
  return reason ? { ok: false, error: safeErrorMessage(e), reason } : { ok: false, error: safeErrorMessage(e) };
}

/** Every listed permission, checked on the server (CLAUDE.md rule 1). */
async function requireAll(first: Permission, ...rest: Permission[]) {
  const user = await assertPermission(first);
  if (rest.some((p) => !can(user.role, p))) throw new AuthorizationError();
  return user;
}

function revalidateSchedule(projectId?: string) {
  revalidatePath("/schedule");
  revalidatePath("/my-jobs");
  revalidatePath("/projects");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  // Booking can move a job between "Need to schedule" and "Scheduled".
  revalidatePath("/");
}

export async function createEntryAction(input: unknown): Promise<EntryActionResult> {
  try {
    const user = await requireAll("schedule.write");
    const v = createEntrySchema.parse(input);
    const r = await createEntry(v, user);
    revalidateSchedule(r.entry.projectId);
    return { ok: true, entry: r.entry, warnings: r.warnings };
  } catch (e) {
    return fail(e);
  }
}

export async function updateEntryAction(input: unknown): Promise<EntryActionResult> {
  try {
    const user = await requireAll("schedule.write");
    const v = updateEntrySchema.parse(input);
    const r = await updateEntry(v, user);
    revalidateSchedule(r.entry.projectId);
    return { ok: true, entry: r.entry, warnings: r.warnings };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEntryAction(input: unknown): Promise<OkResult> {
  try {
    const user = await requireAll("schedule.write");
    const v = deleteEntrySchema.parse(input);
    const r = await deleteEntry(v, user);
    revalidateSchedule(r.projectId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function splitEntryAction(input: unknown): Promise<SplitActionResult> {
  try {
    const user = await requireAll("schedule.write");
    const v = splitEntrySchema.parse(input);
    const r = await splitEntry(v, user);
    revalidateSchedule(r.entries[0].projectId);
    return { ok: true, entries: r.entries };
  } catch (e) {
    return fail(e);
  }
}

export async function setReadinessAction(input: unknown): Promise<ReadinessActionResult> {
  try {
    const user = await requireAll("schedule.write");
    const v = readinessSchema.parse(input);
    const item = await setReadinessItem(v, user);
    revalidateSchedule(v.projectId);
    return { ok: true, item };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSchedulingPrefsAction(input: unknown): Promise<PrefsActionResult> {
  try {
    const user = await requireAll("schedule.write");
    const v = schedulingPrefsSchema.parse(input);
    const scheduling = await saveSchedulingPrefs(v, user);
    revalidateSchedule(v.projectId);
    return { ok: true, scheduling };
  } catch (e) {
    return fail(e);
  }
}

/** "Mark in progress" once the first work day has come. Never automatic. */
export async function markInProgressAction(input: unknown): Promise<OkResult> {
  try {
    const user = await requireAll("schedule.write", "projects.write");
    const v = projectIdSchema.parse(input);
    const r = await markProjectInProgress(v, user);
    revalidateSchedule(v.projectId);
    revalidatePath("/performance");
    return { ok: true, message: r.changed ? "Marked in progress" : "Already in progress" };
  } catch (e) {
    return fail(e);
  }
}

/** The "Finished?" list: complete the job with its last work day as the finish date. */
export async function completeFromScheduleAction(input: unknown): Promise<CompleteActionResult> {
  try {
    const user = await requireAll("projects.write", "schedule.read");
    const v = projectIdSchema.parse(input);
    const r = await completeFromSchedule(v, user);
    revalidateSchedule(v.projectId);
    revalidatePath("/performance");
    return { ok: true, finishDate: r.finishDate };
  } catch (e) {
    return fail(e);
  }
}

export async function previewStartNoticeAction(input: unknown): Promise<PreviewActionResult> {
  try {
    const user = await requireAll("schedule.write", "messages.send");
    const v = noticePreviewSchema.parse(input);
    const p = await composeStartNotice(v.projectId, v.kind, { name: user.name }, { variant: v.variant });
    return {
      ok: true,
      preview: {
        to: p.to,
        subject: p.subject,
        body: p.body,
        variant: p.variant,
        startDate: p.startDate,
        endDate: p.endDate,
        weekOf: p.weekOf,
        workingDays: p.workingDays,
        problems: p.problems,
        blocked: p.blocked,
        pastStart: p.pastStart,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

/** "Grandview Painting <info@…>" → "info@…". */
function senderAddress(): string | null {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return null;
  return /<([^>]+)>/.exec(from)?.[1] ?? from;
}

/** Sends exactly the text the user previewed and edited (CLAUDE.md rule 8). */
export async function sendStartNoticeAction(input: unknown): Promise<OkResult> {
  try {
    const user = await requireAll("schedule.write", "messages.send");
    const v = noticeSendSchema.parse(input);
    const r = await sendStartNotice(v, user);
    revalidateSchedule(v.projectId);
    const from = senderAddress();
    return { ok: true, message: r.status === "logged" ? "Logged (email delivery is not configured in this environment)" : from ? `Sent from ${from}` : "Sent" };
  } catch (e) {
    return fail(e);
  }
}

export async function markStartConfirmedAction(input: unknown): Promise<OkResult> {
  try {
    const user = await requireAll("schedule.write", "messages.send");
    const v = confirmSchema.parse(input);
    await markStartConfirmed(v, user);
    revalidateSchedule(v.projectId);
    return { ok: true, message: v.kind === "start_week" ? "Week confirmed" : "Date confirmed" };
  } catch (e) {
    return fail(e);
  }
}

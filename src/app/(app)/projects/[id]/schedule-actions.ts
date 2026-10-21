"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission, AuthorizationError } from "@/lib/authz/guard";
import { can, type Permission } from "@/lib/authz/permissions";
import { dateRangeLabel, shortDay } from "@/lib/schedule/format";
import { confirmSchema, createEntrySchema, projectIdSchema, readinessSchema, removeProjectEntriesSchema, schedulingPrefsSchema } from "@/lib/schedule/schemas";
import type { ScheduleWarning } from "@/lib/schedule/types";
import { setReadinessItem } from "@/server/readiness";
import { createEntry, markProjectInProgress, removeProjectEntries, saveSchedulingPrefs, ScheduleError, type ScheduleErrorReason } from "@/server/schedule";
import { markStartConfirmed } from "@/server/start-notices";

/** Server actions for the project page's Schedule card. Thin: permission, zod, service, revalidate. */

export type ScheduleCardResult =
  | { ok: true; message: string; warnings?: string[] }
  | { ok: false; error: string; reason?: ScheduleErrorReason };

async function assertAll(...perms: [Permission, ...Permission[]]) {
  const user = await assertPermission(perms[0]);
  if (perms.slice(1).some((p) => !can(user.role, p))) throw new AuthorizationError();
  return user;
}

function fail(e: unknown): ScheduleCardResult {
  // Zod paths ("startDate: …") mean nothing to the owner; the message alone does.
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
  const r = actionError(e);
  return e instanceof ScheduleError && e.reason ? { ...r, reason: e.reason } : r;
}

function revalidateSchedule(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/schedule");
  revalidatePath("/my-jobs");
}

const WEEKDAY_NAMES = new Set(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

function dayList(days: string[]): string {
  return days.length <= 3 ? days.map(shortDay).join(", ") : `${shortDay(days[0])} and ${days.length - 1} more days`;
}

function warningText(w: ScheduleWarning): string | null {
  switch (w.type) {
    case "double_booked":
      return `${w.crewName || "This crew"} is double-booked on ${dayList(w.dates)}${w.otherProjectNumbers.length ? ` (also on ${w.otherProjectNumbers.map((n) => `#${n}`).join(", ")})` : ""}.`;
    case "person_double_booked":
      return `${w.userName} is also booked with another crew on ${dayList(w.dates)}.`;
    case "non_working": {
      // Weekends are skipped by design; only holidays and closed days are worth a mention.
      const closed = w.days.filter((d) => !WEEKDAY_NAMES.has(d.label));
      return closed.length ? `Includes days off that aren't counted: ${closed.map((d) => `${shortDay(d.date)} (${d.label})`).join(", ")}.` : null;
    }
    case "not_ready":
      return `Not ready yet: ${w.missing.join(", ")}.`;
    case "before_not_before":
      return `This starts before the job's “not before” date (${shortDay(w.notBefore)}).`;
    case "in_past":
      return "The start date is in the past.";
    case "customer_told":
      return `The customer was told ${shortDay(w.communicatedStart)}; it now starts ${shortDay(w.newStart)}. Send them an updated start date.`;
  }
}

/** "Schedule this job": book the project onto a crew (or no crew yet). */
export async function createBookingAction(input: unknown): Promise<ScheduleCardResult> {
  try {
    const user = await assertAll("schedule.write");
    const v = createEntrySchema.parse(input);
    const { entry, warnings } = await createEntry(v, user);
    revalidateSchedule(entry.projectId);
    return {
      ok: true,
      message: `Booked ${dateRangeLabel(entry.startDate, entry.endDate)}${entry.crewName ? ` with ${entry.crewName}` : " (no crew yet)"}.`,
      warnings: warnings.map(warningText).filter((t): t is string => !!t),
    };
  } catch (e) {
    return fail(e);
  }
}

/** Takes every booking of the project off the calendar (used for cancelled jobs). */
export async function removeAllBookingsAction(input: unknown): Promise<ScheduleCardResult> {
  try {
    const user = await assertAll("schedule.write");
    const v = removeProjectEntriesSchema.parse(input);
    const { removed } = await removeProjectEntries(v, user);
    revalidateSchedule(v.projectId);
    return { ok: true, message: removed ? `Removed ${removed} booking${removed === 1 ? "" : "s"} from the calendar.` : "Nothing was on the calendar." };
  } catch (e) {
    return fail(e);
  }
}

export async function setReadinessAction(input: unknown): Promise<ScheduleCardResult> {
  try {
    const user = await assertAll("schedule.write");
    const v = readinessSchema.parse(input);
    const item = await setReadinessItem(v, user);
    revalidatePath(`/projects/${v.projectId}`);
    revalidatePath("/schedule");
    return { ok: true, message: `${item.label}: ${item.stateLabel}` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSchedulingPrefsAction(input: unknown): Promise<ScheduleCardResult> {
  try {
    const user = await assertAll("schedule.write");
    const v = schedulingPrefsSchema.parse(input);
    await saveSchedulingPrefs(v, user);
    revalidatePath(`/projects/${v.projectId}`);
    revalidatePath("/schedule");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function markInProgressAction(input: unknown): Promise<ScheduleCardResult> {
  try {
    const user = await assertAll("schedule.write", "projects.write");
    const v = projectIdSchema.parse(input);
    const r = await markProjectInProgress(v, user);
    revalidateSchedule(v.projectId);
    revalidatePath("/performance");
    revalidatePath("/");
    return { ok: true, message: r.changed ? "Marked in progress" : "No change" };
  } catch (e) {
    return fail(e);
  }
}

/** The customer confirmed the start week or date (email reply, phone, text, in person). */
export async function markStartConfirmedAction(input: unknown): Promise<ScheduleCardResult> {
  try {
    const user = await assertAll("schedule.write", "messages.send");
    const v = confirmSchema.parse(input);
    await markStartConfirmed(v, user);
    revalidatePath(`/projects/${v.projectId}`);
    revalidatePath("/schedule");
    revalidatePath("/my-jobs");
    return { ok: true, message: "Confirmation saved" };
  } catch (e) {
    return fail(e);
  }
}

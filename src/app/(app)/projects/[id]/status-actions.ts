"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PROJECT_STATUSES } from "@/db/schema";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { isIsoDate } from "@/lib/calendar-date";
import { changeProjectStatus, setCompletionDate, STATUS_NOTE_MAX } from "@/server/project-status";

export type StatusActionResult = { ok: true; message: string } | { ok: false; error: string };

const isoDate = z.string().refine(isIsoDate, "Enter a date like 2026-10-14.");
const projectId = z.string().uuid("Project not found.");

const changeSchema = z.object({
  projectId,
  status: z.enum(PROJECT_STATUSES, "Choose a status."),
  effectiveDate: isoDate.optional(),
  note: z.string().trim().max(STATUS_NOTE_MAX, `Keep the note under ${STATUS_NOTE_MAX} characters.`).optional(),
});

const completionSchema = z.object({ projectId, date: isoDate });

function revalidateProject(id: string) {
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  revalidatePath("/performance");
  revalidatePath("/");
}

export async function changeProjectStatusAction(input: unknown): Promise<StatusActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const v = changeSchema.parse(input);
    const r = await changeProjectStatus(v.projectId, v.status, { actorId: user.id, effectiveDate: v.effectiveDate ?? null, note: v.note ?? null });
    revalidateProject(v.projectId);
    return { ok: true, message: r.changed ? "Status saved" : "No change" };
  } catch (e) {
    return actionError(e);
  }
}

export async function setCompletionDateAction(input: unknown): Promise<StatusActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const v = completionSchema.parse(input);
    const r = await setCompletionDate(v.projectId, v.date, user.id);
    revalidateProject(v.projectId);
    return { ok: true, message: r.changed ? "Finish date saved" : "No change" };
  } catch (e) {
    return actionError(e);
  }
}

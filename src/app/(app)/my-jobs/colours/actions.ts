"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { AuthorizationError, getCurrentUser, needsMfaEnrollment } from "@/lib/authz/guard";
import { colourConsultProject, getColourFormForStaff, saveColourSelection, signColourSelectionOnDevice, startColourSelection } from "@/server/colour-selections";

/*
 * The colour consultant's actions. Field logins get no colour permission of their own:
 * every call checks that the user is in the crew of this colour-consult booking, and that
 * the form belongs to that booking's job.
 */

type Result = { ok: true; message?: string; id?: string } | { ok: false; error: string };
const uuid = z.string().uuid("Not found.");

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
  return actionError(e);
}

async function consultant(entry: string, selectionId?: string) {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("Your session has expired. Please sign in again.");
  if (needsMfaEnrollment(user)) throw new AuthorizationError("Set up two-factor authentication first.");
  const projectId = await colourConsultProject(user.id, entry);
  if (!projectId) throw new AuthorizationError("This colour consult isn't booked for your crew any more.");
  if (selectionId !== undefined) {
    const form = await getColourFormForStaff(selectionId);
    if (!form || form.projectId !== projectId) throw new AuthorizationError();
    return { user, entry, projectId, id: form.id };
  }
  return { user, entry, projectId, id: null };
}

export async function startFieldColoursAction(entryId: unknown): Promise<Result> {
  try {
    const c = await consultant(uuid.parse(entryId));
    const r = await startColourSelection(c.projectId, c.user);
    revalidatePath(`/my-jobs/colours/${c.entry}`);
    revalidatePath(`/projects/${c.projectId}`);
    return { ok: true, id: r.id };
  } catch (e) {
    return fail(e);
  }
}

export async function saveFieldColoursAction(entryId: unknown, selectionId: unknown, input: unknown): Promise<Result> {
  try {
    const c = await consultant(uuid.parse(entryId), uuid.parse(selectionId));
    await saveColourSelection(c.id!, z.unknown().parse(input), c.user);
    revalidatePath(`/projects/${c.projectId}`);
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function signFieldColoursAction(entryId: unknown, selectionId: unknown, input: unknown): Promise<Result> {
  try {
    const c = await consultant(uuid.parse(entryId), uuid.parse(selectionId));
    await signColourSelectionOnDevice(c.id!, z.unknown().parse(input), c.user);
    revalidatePath(`/my-jobs/colours/${c.entry}`);
    revalidatePath(`/projects/${c.projectId}`);
    return { ok: true, message: "Signed. The office has the colours now. They'll be on the work order when the office issues a new version." };
  } catch (e) {
    return fail(e);
  }
}

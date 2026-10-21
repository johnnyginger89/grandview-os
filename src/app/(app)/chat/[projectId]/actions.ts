"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { addChannelMember, removeChannelMember } from "@/server/job-chat";

type Result = { ok: true } | { ok: false; error: string };
const projectSchema = z.string().uuid("Job not found.");
const userSchema = z.string().min(1, "Choose a person.").max(100);

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
  return actionError(e);
}

export async function addMemberAction(projectId: unknown, userId: unknown): Promise<Result> {
  try {
    const actor = await assertPermission("projects.write");
    const r = await addChannelMember(actor, { projectId: projectSchema.parse(projectId), userId: userSchema.parse(userId) });
    revalidatePath(`/chat/${r.projectId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMemberAction(projectId: unknown, userId: unknown): Promise<Result> {
  try {
    const actor = await assertPermission("projects.write");
    const r = await removeChannelMember(actor, { projectId: projectSchema.parse(projectId), userId: userSchema.parse(userId) });
    revalidatePath(`/chat/${r.projectId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

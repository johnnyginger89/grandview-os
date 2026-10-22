"use server";
import { revalidatePath } from "next/cache";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { projectManagerSchema, setProjectManager } from "@/server/project-manager";

export type ProjectManagerResult = { ok: true; message: string } | { ok: false; error: string };

export async function setProjectManagerAction(input: unknown): Promise<ProjectManagerResult> {
  try {
    const user = await assertPermission("projects.write");
    const r = await setProjectManager(projectManagerSchema.parse(input), user);
    revalidatePath(`/projects/${r.projectId}`);
    revalidatePath(`/chat/${r.projectId}`);
    return { ok: true, message: r.changed ? "Project manager saved" : "No change" };
  } catch (e) {
    return actionError(e);
  }
}

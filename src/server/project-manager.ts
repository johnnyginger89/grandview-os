import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects, user } from "@/db/schema";
import { can } from "@/lib/authz/permissions";
import { audit } from "./audit";
import { postSystemMessage } from "./job-chat";

/*
 * The job's project manager: the office person it belongs to. They are in the job's
 * chat (and told about its messages), hear when the customer signs colours, and are the
 * work order's "Office contact" from its next issued version. All of those read
 * projects.project_manager_id when they run. Only active staff who can manage jobs
 * (projects.write) qualify. Callers check projects.write.
 */

export class ProjectManagerError extends Error {
  readonly expose = true;
}

export interface ProjectManagerOption {
  id: string;
  name: string;
}

const canManageJobs = (u: { role: string; active: boolean }) => u.active && can(u.role, "projects.write");

/** Who can be picked, by name. The current project manager stays listed (marked) if they no longer qualify. */
export async function projectManagerOptions(currentId: string | null): Promise<ProjectManagerOption[]> {
  const rows = await db.select({ id: user.id, name: user.name, role: user.role, active: user.active }).from(user).orderBy(asc(user.name));
  return rows
    .filter((u) => canManageJobs(u) || u.id === currentId)
    .map((u) => ({ id: u.id, name: canManageJobs(u) ? u.name : `${u.name} (no longer manages jobs)` }));
}

export const projectManagerSchema = z.object({
  projectId: z.string().uuid("Job not found."),
  /** Null = no project manager. */
  userId: z.string().trim().min(1).max(100).nullable(),
});

export async function setProjectManager(raw: unknown, actor: { id: string }): Promise<{ projectId: string; changed: boolean }> {
  const input = projectManagerSchema.parse(raw);
  const r = await db.transaction(async (tx) => {
    const [p] = await tx.select({ id: projects.id, current: projects.projectManagerId }).from(projects).where(eq(projects.id, input.projectId)).for("update");
    if (!p) throw new ProjectManagerError("This job no longer exists.");
    let name: string | null = null;
    if (input.userId) {
      const [u] = await tx.select({ name: user.name, role: user.role, active: user.active }).from(user).where(eq(user.id, input.userId)).limit(1);
      if (!u || !canManageJobs(u)) throw new ProjectManagerError("That person can't manage jobs. Pick someone else.");
      name = u.name;
    }
    if (p.current === input.userId) return { changed: false, name };
    await tx.update(projects).set({ projectManagerId: input.userId, updatedAt: new Date() }).where(eq(projects.id, p.id));
    await audit({ actorId: actor.id, action: "project.project_manager", entityType: "project", entityId: p.id, before: { projectManagerId: p.current }, after: { projectManagerId: input.userId } }, tx);
    return { changed: true, name };
  });
  if (r.changed) await postSystemMessage(input.projectId, r.name ? `${r.name} is the project manager now.` : "This job has no project manager now.");
  return { projectId: input.projectId, changed: r.changed };
}

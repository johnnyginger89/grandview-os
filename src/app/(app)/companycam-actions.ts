"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import {
  createCompanyCamProject,
  linkCompanyCamProject,
  searchCompanyCamProjects,
  unlinkCompanyCamProject,
  type CompanyCamProject,
} from "@/server/integrations/companycam";

/*
 * Linking an estimate or a job to its CompanyCam project. Writing needs the right to
 * change that estimate (estimates.write) or job (projects.write).
 */

type Result = { ok: true } | { ok: false; error: string };
const entitySchema = z.object({ entityType: z.enum(["project", "estimate"]), entityId: z.string().uuid("Not found.") });

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
  return actionError(e);
}

const permissionFor = (t: "project" | "estimate") => (t === "estimate" ? "estimates.write" : "projects.write");
const pathFor = (t: "project" | "estimate", id: string) => (t === "estimate" ? `/estimates/${id}` : `/projects/${id}`);

export async function searchCompanyCamAction(entity: unknown, query: unknown): Promise<{ ok: true; projects: CompanyCamProject[] } | { ok: false; error: string }> {
  try {
    const e = entitySchema.parse(entity);
    await assertPermission(permissionFor(e.entityType));
    return { ok: true, projects: await searchCompanyCamProjects(z.string().max(100).parse(query)) };
  } catch (err) {
    return fail(err);
  }
}

export async function linkCompanyCamAction(entity: unknown, companyCamProjectId: unknown): Promise<Result> {
  try {
    const e = entitySchema.parse(entity);
    const user = await assertPermission(permissionFor(e.entityType));
    await linkCompanyCamProject({ ...e, companyCamProjectId: z.string().parse(companyCamProjectId) }, user);
    revalidatePath(pathFor(e.entityType, e.entityId));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function createCompanyCamAction(entity: unknown): Promise<Result> {
  try {
    const e = entitySchema.parse(entity);
    const user = await assertPermission(permissionFor(e.entityType));
    await createCompanyCamProject(e, user);
    revalidatePath(pathFor(e.entityType, e.entityId));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function unlinkCompanyCamAction(entity: unknown): Promise<Result> {
  try {
    const e = entitySchema.parse(entity);
    const user = await assertPermission(permissionFor(e.entityType));
    await unlinkCompanyCamProject(e, user);
    revalidatePath(pathFor(e.entityType, e.entityId));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

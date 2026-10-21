"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { createLinkSchema, createWorkOrderSchema, issueWorkOrderSchema, revokeLinkSchema, updateWorkOrderSchema, workOrderIdSchema } from "@/lib/work-orders/schemas";
import { cancelWorkOrder, createShareLink, createWorkOrder, issueWorkOrder, revokeShareLink, updateWorkOrder } from "@/server/work-orders";

export type WorkOrderActionResult = { ok: true; message: string; id?: string } | { ok: false; error: string };
export type CreateLinkResult = { ok: true; message: string; linkId: string; url: string; expiresAt: string } | { ok: false; error: string };

/** Form problems read as plain sentences (no field paths) for the owner. */
function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
  return actionError(e);
}

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/my-jobs");
}

export async function createWorkOrderAction(input: unknown): Promise<WorkOrderActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const v = createWorkOrderSchema.parse(input);
    const r = await createWorkOrder(v, user);
    refresh(r.projectId);
    return { ok: true, id: r.id, message: "Work order created. Crews can't see it until you issue it." };
  } catch (e) {
    return fail(e);
  }
}

export async function updateWorkOrderAction(input: unknown): Promise<WorkOrderActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const v = updateWorkOrderSchema.parse(input);
    const r = await updateWorkOrder(v, user);
    refresh(r.projectId);
    return { ok: true, id: r.id, message: "Changes saved. Issue a new version when the crew should see them." };
  } catch (e) {
    return fail(e);
  }
}

export async function issueWorkOrderAction(input: unknown): Promise<WorkOrderActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const v = issueWorkOrderSchema.parse(input);
    const r = await issueWorkOrder(v, user);
    refresh(r.projectId);
    return { ok: true, id: r.id, message: `Version ${r.version} issued.` };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelWorkOrderAction(input: unknown): Promise<WorkOrderActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const v = workOrderIdSchema.parse(input);
    const r = await cancelWorkOrder(v, user);
    refresh(r.projectId);
    return { ok: true, id: r.id, message: "Work order cancelled." };
  } catch (e) {
    return fail(e);
  }
}

export async function createShareLinkAction(input: unknown): Promise<CreateLinkResult> {
  try {
    const user = await assertPermission("projects.write");
    const v = createLinkSchema.parse(input);
    const r = await createShareLink(v, user);
    refresh(r.projectId);
    return { ok: true, message: "Link created.", linkId: r.linkId, url: r.url, expiresAt: r.expiresAt };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeShareLinkAction(input: unknown): Promise<WorkOrderActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const v = revokeLinkSchema.parse(input);
    const r = await revokeShareLink(v, user);
    refresh(r.projectId);
    return { ok: true, message: "Link turned off. Anyone using it now sees that it has expired." };
  } catch (e) {
    return fail(e);
  }
}

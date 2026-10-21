"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { ESTIMATE_STATUSES } from "@/db/schema";
import { assertPermission } from "@/lib/authz/guard";
import {
  createEstimate,
  createRevision,
  duplicateEstimate,
  restoreRevision,
  saveAsTemplate,
  saveEstimateDoc,
  setEstimateStatus,
  templateToDocParts,
} from "@/server/estimates";
import { acceptForCustomerSchema, acceptProposalForCustomer, sendProposal, withdrawProposal } from "@/server/proposals";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();

function err(e: unknown): { ok: false; error: string } {
  return { ok: false, error: safeErrorMessage(e) };
}

export async function createEstimateAction(_: unknown, f: FormData): Promise<Result> {
  let id: string;
  try {
    const user = await assertPermission("estimates.write");
    const row = await createEstimate(
      {
        customerId: (f.get("customerId") as string) || null,
        opportunityId: (f.get("opportunityId") as string) || null,
        propertyId: (f.get("propertyId") as string) || null,
        title: String(f.get("title") ?? ""),
        jobType: String(f.get("jobType") ?? "interior"),
      },
      user.id,
    );
    id = row.id;
  } catch (e) {
    return err(e);
  }
  revalidatePath("/estimates");
  redirect(`/estimates/${id}`);
}

export async function saveEstimateAction(id: string, doc: unknown): Promise<Result<{ totals: Record<string, string>; updatedAt: string }>> {
  try {
    await assertPermission("estimates.write");
    const r = await saveEstimateDoc(uuid.parse(id), doc);
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function createRevisionAction(id: string, reason: string): Promise<Result<{ revision: number }>> {
  try {
    const user = await assertPermission("estimates.write");
    const revision = await createRevision(uuid.parse(id), reason.trim() || null, user.id);
    revalidatePath(`/estimates/${id}`);
    return { ok: true, revision };
  } catch (e) {
    return err(e);
  }
}

export async function restoreRevisionAction(id: string, revision: number): Promise<Result> {
  try {
    const user = await assertPermission("estimates.write");
    await restoreRevision(uuid.parse(id), z.number().int().parse(revision), user.id);
    revalidatePath(`/estimates/${id}`);
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function setStatusAction(id: string, status: string): Promise<Result> {
  try {
    const user = await assertPermission("estimates.write");
    await setEstimateStatus(uuid.parse(id), z.enum(ESTIMATE_STATUSES).parse(status), user.id);
    revalidatePath(`/estimates/${id}`);
    revalidatePath("/estimates");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function duplicateAction(id: string): Promise<Result> {
  let newId: string;
  try {
    const user = await assertPermission("estimates.write");
    newId = (await duplicateEstimate(uuid.parse(id), user.id)).id;
  } catch (e) {
    return err(e);
  }
  redirect(`/estimates/${newId}`);
}

export async function saveTemplateAction(id: string, name: string): Promise<Result> {
  try {
    const user = await assertPermission("estimates.write");
    await saveAsTemplate(uuid.parse(id), z.string().trim().min(1).max(120).parse(name), user.id);
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function templatePartsAction(templateId: string) {
  await assertPermission("estimates.write");
  return templateToDocParts(uuid.parse(templateId));
}

export async function sendProposalAction(id: string, input: { to: string; message: string; email: boolean; subject?: string; body?: string }): Promise<Result<{ link: string; emailStatus: string; emailError?: string }>> {
  try {
    const user = await assertPermission("estimates.write");
    const r = await sendProposal(uuid.parse(id), input, user);
    revalidatePath(`/estimates/${id}`);
    return { ok: true, link: r.link, emailStatus: r.emailStatus, emailError: r.emailError };
  } catch (e) {
    return err(e);
  }
}

/** The customer said yes by phone, email, in person or on paper: accept for them and create the job. */
export async function acceptForCustomerAction(estimateId: string, input: unknown): Promise<Result<{ projectId: string | null }>> {
  try {
    const user = await assertPermission("estimates.write");
    const id = uuid.parse(estimateId);
    const data = acceptForCustomerSchema.parse(input);
    const r = await acceptProposalForCustomer(id, data, user);
    revalidatePath(`/estimates/${id}`);
    revalidatePath("/projects");
    return { ok: true, projectId: r.projectId };
  } catch (e) {
    return err(e);
  }
}

export async function withdrawProposalAction(estimateId: string, proposalId: string): Promise<Result> {
  try {
    const user = await assertPermission("estimates.write");
    await withdrawProposal(uuid.parse(proposalId), user.id);
    revalidatePath(`/estimates/${estimateId}`);
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

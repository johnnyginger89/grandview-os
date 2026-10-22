"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { ESTIMATE_STATUSES } from "@/db/schema";
import { assertPermission } from "@/lib/authz/guard";
import { searchCustomers } from "@/server/search";
import {
  createEstimate,
  createRevision,
  duplicateEstimate,
  EstimateLockedError,
  EstimateStaleError,
  restoreRevision,
  saveAsTemplate,
  saveEstimateDoc,
  setEstimateStatus,
  templateToDocParts,
} from "@/server/estimates";
import {
  acceptancePreview,
  acceptForCustomerSchema,
  acceptProposalForCustomer,
  draftTotals,
  followUpDraft,
  followUpSchema,
  sendProposal,
  sendProposalFollowUp,
  withdrawProposal,
  type AcceptancePreview,
  type ProposalTotals,
} from "@/server/proposals";

/** `conflict`: the screen is out of date (changed elsewhere, or accepted), so the editor stops saving and offers a reload. */
type Failure = { ok: false; error: string; conflict?: boolean };
type Result<T = object> = ({ ok: true } & T) | Failure;
const uuid = z.string().uuid();
/** The estimate version (updatedAt) the screen's copy is based on. */
const version = z.string().datetime({ offset: true });

function err(e: unknown): Failure {
  if (e instanceof EstimateStaleError || e instanceof EstimateLockedError) return { ok: false, error: e.message, conflict: true };
  return { ok: false, error: safeErrorMessage(e) };
}

const optionalId = z.preprocess((v) => (v === "" || v == null ? null : v), uuid.nullable());
const newEstimateSchema = z.object({
  customerId: optionalId,
  opportunityId: optionalId,
  propertyId: optionalId,
  templateId: optionalId,
  title: z.string().trim().max(200).default(""),
  jobType: z.string().trim().max(40).default("interior"),
});

export async function createEstimateAction(_: unknown, f: FormData): Promise<Result> {
  let id: string;
  try {
    const user = await assertPermission("estimates.write");
    const input = newEstimateSchema.parse({
      customerId: f.get("customerId"),
      opportunityId: f.get("opportunityId"),
      propertyId: f.get("propertyId"),
      templateId: f.get("templateId"),
      title: f.get("title") ?? undefined,
      jobType: f.get("jobType") ?? undefined,
    });
    const row = await createEstimate(input, user.id);
    id = row.id;
  } catch (e) {
    return err(e);
  }
  revalidatePath("/estimates");
  redirect(`/estimates/${id}`);
}

/** Autosave. `expectedUpdatedAt` is the version the editor's copy is based on; a stale one is refused. */
export async function saveEstimateAction(id: string, doc: unknown, expectedUpdatedAt: string): Promise<Result<{ totals: Record<string, string>; updatedAt: string }>> {
  try {
    await assertPermission("estimates.write");
    const r = await saveEstimateDoc(uuid.parse(id), doc, version.parse(expectedUpdatedAt));
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

export async function setStatusAction(id: string, status: string, expectedUpdatedAt: string): Promise<Result<{ updatedAt: string }>> {
  try {
    const user = await assertPermission("estimates.write");
    const r = await setEstimateStatus(uuid.parse(id), z.enum(ESTIMATE_STATUSES).parse(status), user.id, version.parse(expectedUpdatedAt));
    revalidatePath(`/estimates/${id}`);
    revalidatePath("/estimates");
    return { ok: true, updatedAt: r.updatedAt };
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

export async function sendProposalAction(
  id: string,
  input: { to: string; message: string; email: boolean; subject?: string; body?: string; expectedUpdatedAt?: string },
): Promise<Result<{ link: string; emailStatus: string; emailError?: string; updatedAt: string }>> {
  try {
    const user = await assertPermission("estimates.write");
    const r = await sendProposal(uuid.parse(id), input, user);
    revalidatePath(`/estimates/${id}`);
    return { ok: true, link: r.link, emailStatus: r.emailStatus, emailError: r.emailError, updatedAt: r.updatedAt };
  } catch (e) {
    return err(e);
  }
}

/** "Mark as accepted": the upgrades, the customer's pre-selection and the totals, from the saved copy at the screen's version. */
export async function acceptPreviewAction(estimateId: string, expectedUpdatedAt: string): Promise<Result<AcceptancePreview>> {
  try {
    await assertPermission("estimates.write");
    return { ok: true, ...(await acceptancePreview(uuid.parse(estimateId), version.parse(expectedUpdatedAt))) };
  } catch (e) {
    return err(e);
  }
}

/** Live totals in "Mark as accepted" as upgrades are ticked, worked out the same way as on the customer's page. */
export async function acceptTotalsAction(estimateId: string, selectedIds: string[]): Promise<Result<{ totals: ProposalTotals }>> {
  try {
    await assertPermission("estimates.write");
    const totals = await draftTotals(uuid.parse(estimateId), z.array(uuid).max(200).parse(selectedIds));
    return totals ? { ok: true, totals } : { ok: false, error: "Estimate not found" };
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

/** The follow-up email for an open proposal, filled in and ready to check. */
export async function followUpDraftAction(proposalId: string): Promise<Result<{ draft: { to: string; subject: string; body: string } }>> {
  try {
    const user = await assertPermission("estimates.write");
    return { ok: true, draft: await followUpDraft(uuid.parse(proposalId), user) };
  } catch (e) {
    return err(e);
  }
}

export async function sendFollowUpAction(proposalId: string, input: unknown): Promise<Result<{ status: string; emailError?: string }>> {
  try {
    const user = await assertPermission("estimates.write");
    const id = uuid.parse(proposalId);
    const data = followUpSchema.parse(input);
    const r = await sendProposalFollowUp(id, data, user);
    if (r.status === "failed") return { ok: false, error: `The email couldn't be sent: ${r.error ?? "email isn't set up"}.` };
    revalidatePath("/");
    revalidatePath("/estimates/[id]", "page");
    return { ok: true, status: r.status };
  } catch (e) {
    return err(e);
  }
}

/** Customer search for "New estimate". */
export async function findCustomersAction(query: string): Promise<{ id: string; name: string; detail: string }[]> {
  await assertPermission("estimates.write");
  await assertPermission("customers.read");
  return searchCustomers(z.string().max(100).parse(query));
}

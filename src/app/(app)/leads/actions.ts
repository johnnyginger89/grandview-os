"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { followUpInstant } from "@/lib/pipeline/list-view";
import { assignEstimatorInput, bulkMoveStageInput, followUpInput, lostReasonSchema } from "@/lib/pipeline/schemas";
import { parseBusinessDateTime } from "@/lib/time";
import { addNote, assignEstimator, bulkMoveStage, composeBookingEmail, ingestLead, moveStage, sendBookingLink, setNextFollowUp } from "@/server/leads";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: safeErrorMessage(e) };
}

function revalidateLeads() {
  revalidatePath("/leads");
  revalidatePath("/leads/[id]", "page");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function createLeadAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const user = await assertPermission("pipeline.write");
    const stageKey = String(form.get("stage") ?? "new_lead");
    if (!["new_lead", "contacted", "estimate_booked"].includes(stageKey)) throw new Error("Invalid stage");
    const visit = String(form.get("visitAt") ?? "");
    const result = await ingestLead(
      {
        firstName: String(form.get("firstName") ?? ""),
        lastName: String(form.get("lastName") ?? ""),
        company: String(form.get("company") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""),
        street: String(form.get("street") ?? ""),
        unit: String(form.get("unit") ?? ""),
        city: String(form.get("city") ?? ""),
        postalCode: String(form.get("postalCode") ?? ""),
        propertyType: String(form.get("propertyType") ?? ""),
        projectTypes: form.getAll("projectTypes").map(String),
        description: String(form.get("description") ?? ""),
        timeline: String(form.get("timeline") ?? ""),
        leadSource: String(form.get("leadSource") ?? ""),
        visitAt: parseBusinessDateTime(visit),
        notes: String(form.get("notes") ?? ""),
      },
      { stageKey, channel: (String(form.get("channel") || "phone") as "phone"), actorId: user.id },
    );
    if (!result.created && !result.matchedExistingCustomer) throw new Error("Lead could not be created");
    id = result.opportunityId;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/leads");
  redirect(`/leads/${id}`);
}

export async function moveStageAction(opportunityId: string, stageId: string, lostReason?: string): Promise<ActionResult> {
  try {
    const user = await assertPermission("pipeline.write");
    const id = z.string().uuid().parse(opportunityId);
    await moveStage(id, z.string().uuid().parse(stageId), user.id, lostReasonSchema.parse(lostReason) ?? null);
    revalidatePath("/leads");
    revalidatePath(`/leads/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function bulkMoveStageAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await assertPermission("pipeline.write");
    const { ids, stageId, lostReason } = bulkMoveStageInput.parse(input);
    const r = await bulkMoveStage(ids, stageId, user.id, lostReason ?? null);
    revalidateLeads();
    const extra = r.unchanged ? ` (${plural(r.unchanged, "lead")} already there)` : "";
    return { ok: true, message: `${plural(r.moved, "lead")} moved${extra}` };
  } catch (e) {
    return fail(e);
  }
}

export async function setFollowUpAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await assertPermission("pipeline.write");
    const { ids, date } = followUpInput.parse(input);
    const r = await setNextFollowUp(ids, date ? followUpInstant(date) : null, user.id);
    revalidateLeads();
    return { ok: true, message: date ? `Follow-up set for ${plural(r.updated, "lead")}` : `Follow-up cleared for ${plural(r.updated, "lead")}` };
  } catch (e) {
    return fail(e);
  }
}

export async function assignEstimatorAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await assertPermission("pipeline.write");
    const { ids, estimatorId } = assignEstimatorInput.parse(input);
    const r = await assignEstimator(ids, estimatorId, user.id);
    revalidateLeads();
    return { ok: true, message: `Estimator updated on ${plural(r.updated, "lead")}` };
  } catch (e) {
    return fail(e);
  }
}

export async function previewBookingEmailAction(opportunityId: string) {
  const user = await assertPermission("messages.send");
  const m = await composeBookingEmail(z.string().uuid().parse(opportunityId), user.name);
  return { to: m.to, subject: m.subject, body: m.body, bookingUrlConfigured: m.bookingUrlConfigured };
}

export async function sendBookingLinkAction(opportunityId: string): Promise<ActionResult> {
  try {
    const user = await assertPermission("messages.send");
    const r = await sendBookingLink(z.string().uuid().parse(opportunityId), user);
    revalidatePath(`/leads/${opportunityId}`);
    revalidatePath("/leads");
    return { ok: true, message: r.status === "logged" ? "Logged (email delivery is not configured in this environment)" : "Booking link sent" };
  } catch (e) {
    return fail(e);
  }
}

export async function addNoteAction(opportunityId: string, body: string, type: "note" | "call"): Promise<ActionResult> {
  try {
    const user = await assertPermission("pipeline.write");
    const text = z.string().trim().min(1).max(5000).parse(body);
    await addNote(z.string().uuid().parse(opportunityId), text, user.id, z.enum(["note", "call"]).parse(type));
    revalidatePath(`/leads/${opportunityId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

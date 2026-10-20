"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { parseBusinessDateTime } from "@/lib/time";
import { addNote, composeBookingEmail, ingestLead, moveStage, sendBookingLink } from "@/server/leads";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: safeErrorMessage(e) };
}

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
    await moveStage(z.string().uuid().parse(opportunityId), z.string().uuid().parse(stageId), user.id, lostReason ?? null);
    revalidatePath("/leads");
    revalidatePath(`/leads/${opportunityId}`);
    return { ok: true };
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
    await addNote(z.string().uuid().parse(opportunityId), text, user.id, type);
    revalidatePath(`/leads/${opportunityId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

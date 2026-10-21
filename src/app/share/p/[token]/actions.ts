"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { acceptProposal, declineProposal, previewTotals, recordProposalView } from "@/server/proposals";

/** The customer's browser reports that they're looking at the proposal. */
export async function recordViewAction(token: string) {
  try {
    await recordProposalView(z.string().max(100).parse(token));
  } catch (e) {
    console.error("[proposal] could not record a view", e instanceof Error ? e.message : e);
  }
}

export async function previewTotalsAction(token: string, selectedIds: string[]) {
  return previewTotals(token, Array.isArray(selectedIds) ? selectedIds.slice(0, 200).map(String) : []);
}

export async function acceptAction(token: string, input: { name: string; email: string; signature: string; agree: boolean; message?: string; selectedOptionIds: string[] }) {
  try {
    const h = await headers();
    const ip = h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await acceptProposal(token, input, { ip, userAgent: h.get("user-agent") });
    return { ok: true as const };
  } catch (e) {
    // Customers get the plain message, without the field name.
    if (e instanceof z.ZodError) return { ok: false as const, error: e.issues[0]?.message ?? "Please check the form" };
    return { ok: false as const, error: safeErrorMessage(e) };
  }
}

export async function declineAction(token: string, reason: string) {
  try {
    await declineProposal(token, String(reason ?? ""));
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: safeErrorMessage(e) };
  }
}

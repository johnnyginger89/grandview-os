"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { colourLinkSchema } from "@/lib/colours/schemas";
import { cancelColourSelection, createColourLink, saveColourSelection, signColourSelectionOnDevice, startColourSelection } from "@/server/colour-selections";

export type ColourActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };
export type ColourLinkResult = { ok: true; url: string; expiresAt: string; emailed: "sent" | "logged" | "failed" | null; emailError?: string } | { ok: false; error: string };

const idSchema = z.string().uuid("Colour form not found.");

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
  return actionError(e);
}

function refresh(projectId: string, id?: string) {
  revalidatePath(`/projects/${projectId}`);
  if (id) revalidatePath(`/projects/${projectId}/colours/${id}`);
}

/** The job's open colour form, or a new one filled from the signed estimate (or from the signed colours, to change them). */
export async function startColoursAction(projectId: unknown): Promise<ColourActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const r = await startColourSelection(z.string().uuid("Job not found.").parse(projectId), user);
    refresh(r.projectId);
    return { ok: true, id: r.id };
  } catch (e) {
    return fail(e);
  }
}

export async function saveColoursAction(id: unknown, input: unknown): Promise<ColourActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const r = await saveColourSelection(idSchema.parse(id), z.unknown().parse(input), user);
    refresh(r.projectId);
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

/** The customer signs on this device. */
export async function signColoursAction(id: unknown, input: unknown): Promise<ColourActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const r = await signColourSelectionOnDevice(idSchema.parse(id), z.unknown().parse(input), user);
    refresh(r.projectId, r.id);
    revalidatePath("/my-jobs");
    return { ok: true, message: "Signed. The colours are on the job. They'll be on the work order when you issue a new version." };
  } catch (e) {
    return fail(e);
  }
}

export async function sendColourLinkAction(input: unknown): Promise<ColourLinkResult> {
  try {
    const user = await assertPermission("projects.write");
    const r = await createColourLink(colourLinkSchema.parse(input), user);
    refresh(r.projectId);
    return { ok: true, url: r.url, expiresAt: r.expiresAt, emailed: r.emailStatus, emailError: r.emailError };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteColoursAction(id: unknown): Promise<ColourActionResult> {
  try {
    const user = await assertPermission("projects.write");
    const r = await cancelColourSelection(idSchema.parse(id), user);
    refresh(r.projectId);
    return { ok: true, message: "Colour form deleted." };
  } catch (e) {
    return fail(e);
  }
}

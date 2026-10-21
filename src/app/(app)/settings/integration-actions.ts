"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { connectCompanyCam, disconnectCompanyCam } from "@/server/integrations/companycam";
import { disconnectGmail, syncGmail } from "@/server/integrations/gmail";

type Result = { ok: true } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
  return actionError(e);
}

/** Checks the token with CompanyCam, then keeps it encrypted. */
export async function connectCompanyCamAction(token: unknown): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    await connectCompanyCam(z.string().parse(token), user);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectCompanyCamAction(): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    await disconnectCompanyCam(user);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectGmailAction(): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    await disconnectGmail(user);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Checks Gmail for new customer emails now, instead of waiting for the next 10-minute check. */
export async function syncGmailAction(): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  try {
    await assertPermission("settings.manage");
    const r = await syncGmail(new Date());
    revalidatePath("/settings");
    return { ok: true, imported: r.imported };
  } catch (e) {
    return fail(e);
  }
}

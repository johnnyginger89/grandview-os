"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { connectCompanyCam, disconnectCompanyCam } from "@/server/integrations/companycam";

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

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { dismissImport, retryImport } from "@/server/inbound-events";

export type RetryActionResult = { ok: true; message: string; opportunityId: string | null } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/leads/not-imported");
  revalidatePath("/leads");
}

export async function retryImportAction(id: string): Promise<RetryActionResult> {
  try {
    const user = await assertPermission("pipeline.write");
    const r = await retryImport(z.string().uuid().parse(id), user);
    revalidate();
    return r.ok ? { ok: true, message: r.message, opportunityId: r.opportunityId } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}

export async function dismissImportAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertPermission("pipeline.write");
    await dismissImport(z.string().uuid().parse(id), user);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { workOrderSettingsSchema } from "@/lib/work-orders/schemas";
import { saveWorkOrderSettings } from "@/server/work-orders";

export async function saveWorkOrderSettingsAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertPermission("settings.manage");
    const v = workOrderSettingsSchema.parse(input);
    await saveWorkOrderSettings(v, user);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    return actionError(e);
  }
}

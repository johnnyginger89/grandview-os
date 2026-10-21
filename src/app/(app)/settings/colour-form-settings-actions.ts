"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { colourFormSettingsSchema } from "@/lib/colours/schemas";
import { saveColourFormSettings } from "@/server/colour-selections";

export async function saveColourFormSettingsAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertPermission("settings.manage");
    await saveColourFormSettings(colourFormSettingsSchema.parse(input), user);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    return actionError(e);
  }
}

"use server";
import { revalidatePath } from "next/cache";
import { actionError } from "@/lib/action-error";
import { assertPermission, AuthorizationError } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { saveGoals } from "@/server/goals";
import { GOALS_PAYLOAD_MAX_CHARS, goalsPayloadSchema, payloadToGoals } from "./goals-shared";

export type GoalsActionResult = { ok: true } | { ok: false; error: string };

export async function saveGoalsAction(_prev: GoalsActionResult | null, form: FormData): Promise<GoalsActionResult> {
  try {
    const user = await assertPermission("settings.manage");
    // Goals are company revenue targets: admin manages settings but must not see them.
    if (!can(user.role, "financials.read")) throw new AuthorizationError();
    const raw = form.get("payload");
    if (typeof raw !== "string" || raw.length > GOALS_PAYLOAD_MAX_CHARS) throw new Error("The goals couldn't be read. Reload the page and try again.");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error("The goals couldn't be read. Reload the page and try again.");
    }
    const parsed = goalsPayloadSchema.safeParse(json);
    if (!parsed.success) throw new Error("The goals couldn't be read. Reload the page and try again.");
    await saveGoals(payloadToGoals(parsed.data), user.id);
    revalidatePath("/settings");
    revalidatePath("/performance");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return actionError(e);
  }
}

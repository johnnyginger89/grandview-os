"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { crewActiveSchema, crewSchema, reorderCrewsSchema } from "@/lib/schedule/schemas";
import { scheduleSettingsSchema } from "@/lib/schedule/settings-schema";
import { reorderCrews, saveCrew, setCrewActive, setCrewMembers } from "@/server/crews";
import { saveScheduleSettings } from "@/server/schedule-settings";

/** /schedule/setup: crews, crew members and schedule settings. All need schedule.manage. */

export type SetupResult = { ok: true; message: string; id?: string } | { ok: false; error: string; id?: string };

const saveCrewInput = z.object({
  crew: crewSchema,
  members: z.array(z.object({ userId: z.string().min(1).max(64), isLead: z.boolean() })).max(30, "A crew can have at most 30 members"),
});

function fail(e: unknown, id?: string): SetupResult {
  // Show the message without the field path ("crew.name: …").
  const r = e instanceof z.ZodError ? { ok: false as const, error: e.issues[0]?.message ?? "Please check the form." } : actionError(e);
  return id ? { ...r, id } : r;
}

function revalidateSetup(members = false) {
  revalidatePath("/schedule/setup");
  revalidatePath("/schedule");
  if (members) revalidatePath("/my-jobs");
}

/** Create or update a crew and replace its members (membership is what My Jobs shows). */
export async function saveCrewAction(input: unknown): Promise<SetupResult> {
  let id: string | undefined;
  try {
    const user = await assertPermission("schedule.manage");
    const v = saveCrewInput.parse(input);
    id = (await saveCrew(v.crew, user)).id;
    await setCrewMembers({ crewId: id, members: v.members }, user);
    revalidateSetup(true);
    return { ok: true, message: `Saved ${v.crew.name}.`, id };
  } catch (e) {
    // The crew may already be saved when the members fail: return its id so a retry updates it.
    if (id) revalidateSetup(true);
    return fail(e, id);
  }
}

export async function setCrewActiveAction(input: unknown): Promise<SetupResult> {
  try {
    const user = await assertPermission("schedule.manage");
    const v = crewActiveSchema.parse(input);
    await setCrewActive(v, user);
    revalidateSetup(true);
    return { ok: true, message: v.active ? "Crew turned on." : "Crew turned off." };
  } catch (e) {
    return fail(e);
  }
}

export async function reorderCrewsAction(input: unknown): Promise<SetupResult> {
  try {
    const user = await assertPermission("schedule.manage");
    const v = reorderCrewsSchema.parse(input);
    await reorderCrews(v, user);
    revalidateSetup();
    return { ok: true, message: "Order saved." };
  } catch (e) {
    return fail(e);
  }
}

/** Saves the whole `schedule` setting (each tab sends the full object with its changes). */
export async function saveScheduleSettingsAction(input: unknown): Promise<SetupResult> {
  try {
    const user = await assertPermission("schedule.manage");
    const v = scheduleSettingsSchema.parse(input);
    await saveScheduleSettings(v, user);
    revalidateSetup(true);
    revalidatePath("/projects/[id]", "page");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

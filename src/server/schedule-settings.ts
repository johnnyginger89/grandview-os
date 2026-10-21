import "server-only";
import { DEFAULT_PRICING } from "@/db/seed-data";
import { d } from "@/lib/money";
import { defaultScheduleSettings, SCHEDULE_SETTING_KEY, scheduleSettingsSchema, type ScheduleSettings } from "@/lib/schedule/settings-schema";
import type { CrewCapacity } from "@/lib/schedule/duration";
import { audit } from "./audit";
import { getPricing, getSetting, setSetting } from "./settings";

// A separate module from settings.ts so schedule work doesn't touch the proposal settings code.

/** The `schedule` setting, or the code defaults when nothing is saved or the stored value is unreadable. */
export async function getScheduleSettings(): Promise<ScheduleSettings> {
  const raw = await getSetting<unknown>(SCHEDULE_SETTING_KEY, {});
  const parsed = scheduleSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  console.error(`[schedule] stored ${SCHEDULE_SETTING_KEY} setting is invalid, using defaults:`, parsed.error.issues.map((i) => `${i.path.join(".")} ${i.code}`).join("; "));
  return defaultScheduleSettings();
}

/** Callers check schedule.manage. */
export async function saveScheduleSettings(raw: unknown, actor: { id: string }): Promise<ScheduleSettings> {
  const next = scheduleSettingsSchema.parse(raw);
  const before = await getScheduleSettings();
  await setSetting(SCHEDULE_SETTING_KEY, next, actor.id);
  await audit({ actorId: actor.id, action: "settings.schedule", entityType: "settings", entityId: SCHEDULE_SETTING_KEY, before, after: next });
  return next;
}

/** pricing.hoursPerCrewDay, the default hours per person per day (e.g. "8"). */
export async function getHoursPerCrewDay(): Promise<string> {
  const p = await getPricing();
  const h = String(p.hoursPerCrewDay ?? DEFAULT_PRICING.hoursPerCrewDay);
  const n = d(/^\d+(\.\d+)?$/.test(h) ? h : DEFAULT_PRICING.hoursPerCrewDay);
  return n.gt(0) && n.lte(24) ? n.toString() : DEFAULT_PRICING.hoursPerCrewDay;
}

/** The capacity used before a crew is chosen: default crew size × hours per crew day. */
export function defaultCapacity(settings: Pick<ScheduleSettings, "defaultCrewSize">, hoursPerCrewDay: string): CrewCapacity {
  return { crewSize: settings.defaultCrewSize, hoursPerDay: hoursPerCrewDay };
}

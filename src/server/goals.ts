import "server-only";
import { DEFAULT_GOALS } from "@/db/seed-data";
import { goalsSchema, GOALS_SETTING_KEY, normalizeGoals, type Goals } from "@/lib/reporting/goals";
import { audit } from "./audit";
import { getSetting, setSetting } from "./settings";

// Goals are financial targets: callers must check settings.manage and financials.read
// before saving, and must not cache reads across users.

/** The owner's goals, or the starter values when none are saved or the stored value is unreadable. */
export async function getGoals(): Promise<Goals> {
  const raw = await getSetting<unknown>(GOALS_SETTING_KEY, DEFAULT_GOALS);
  const parsed = goalsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Paths and codes only: the stored values are financial targets.
  console.error(`[goals] stored ${GOALS_SETTING_KEY} is invalid, using defaults:`, parsed.error.issues.map((i) => `${i.path.join(".")} ${i.code}`).join("; "));
  return structuredClone(DEFAULT_GOALS);
}

/** Validate and store goals. Monthly targets win over the annual figure. */
export async function saveGoals(raw: unknown, actorId: string): Promise<Goals> {
  // Parse again after normalising so a sum of monthly targets can't store an out-of-range annual figure.
  const next = goalsSchema.parse(normalizeGoals(goalsSchema.parse(raw)));
  const before = await getGoals();
  await setSetting(GOALS_SETTING_KEY, next, actorId);
  await audit({ actorId, action: "settings.goals", entityType: "settings", entityId: GOALS_SETTING_KEY, before, after: next });
  return next;
}

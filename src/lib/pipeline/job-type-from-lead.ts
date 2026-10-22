import type { JobTypeKey } from "@/lib/proposal-template/schema";

export type EstimateJobType = Exclude<JobTypeKey, "default">;

/**
 * The estimate job type for what the customer asked for on the lead (its project types), so a
 * new estimate starts on the right rooms and proposal wording. Matched by keyword because the
 * owner can rename the project types in Settings; null when nothing fits and the estimator picks.
 */
export function jobTypeForProjectTypes(types: readonly string[]): EstimateJobType | null {
  const has = (re: RegExp) => types.some((t) => re.test(t));
  if (has(/commercial/i)) return "commercial";
  if (has(/strata/i)) return "strata";
  const interior = has(/interior/i);
  const exterior = has(/exterior/i);
  if (interior && exterior) return "interior_exterior";
  if (interior) return "interior";
  if (exterior) return "exterior";
  if (has(/cabinet/i)) return "cabinets";
  if (has(/stain|deck|fence/i)) return "staining";
  if (has(/repair|carpentry|drywall|popcorn/i)) return "repairs";
  return null;
}

/**
 * The /performance query string. Anything unexpected falls back to a default
 * instead of failing, so a bad link still shows This month.
 */
import { z } from "zod";
import { COMPARE_MODES, PERIOD_PRESETS } from "./periods";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const performanceQuerySchema = z.object({
  period: z.enum(PERIOD_PRESETS).catch("this_month"),
  compare: z.enum(COMPARE_MODES).catch("prior"),
  from: localDate.optional().catch(undefined),
  to: localDate.optional().catch(undefined),
});
export type PerformanceQuery = z.infer<typeof performanceQuerySchema>;


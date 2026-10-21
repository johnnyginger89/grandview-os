/**
 * Sales and production goals (app_settings key "dashboard_goals"). Pure: shared by
 * the Goals form, the server and the dashboard maths.
 */
import { z } from "zod";
import { d, Decimal } from "@/lib/money";

export const GOALS_SETTING_KEY = "dashboard_goals";
export const MAX_GOAL_YEARS = 30;

/** Pre-GST dollars, no sign, at most 2 decimals. */
export const goalMoney = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 1000000 or 83333.33");

export const yearGoalSchema = z.object({
  sales: goalMoney,
  produced: goalMoney,
  leadsPerMonth: z.number().int().min(0).max(100_000).nullable(),
  /** Index 0 = first month of the fiscal year. Null = annual ÷ 12. */
  monthlySales: z.array(goalMoney).length(12).nullable(),
  monthlyProduced: z.array(goalMoney).length(12).nullable(),
});

export const goalsSchema = z.object({
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  /** Key = calendar year in which the fiscal year starts. */
  years: z
    .record(z.string().regex(/^20\d{2}$/, "Use a year like 2026"), yearGoalSchema)
    .refine((y) => Object.keys(y).length <= MAX_GOAL_YEARS, `At most ${MAX_GOAL_YEARS} years of goals`),
  longTerm: z.object({ amount: goalMoney, year: z.number().int().min(2026).max(2050) }).nullable(),
  excludedLostReasons: z.array(z.string().trim().min(1).max(100)).max(20),
});

export type YearGoal = z.infer<typeof yearGoalSchema>;
export type Goals = z.infer<typeof goalsSchema>;

/**
 * Split an annual goal into 12 monthly goals. Each month gets annual ÷ 12 rounded
 * down to cents and the last month takes the remainder, so the months sum exactly
 * and none goes negative ($1,000,000 → 11 × 83,333.33 + 83,333.37).
 */
export function spreadEvenly(annual: string): string[] {
  const total = d(annual);
  const share = total.div(12).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const months = Array.from({ length: 12 }, () => share.toFixed(2));
  months[11] = total.minus(share.times(11)).toFixed(2);
  return months;
}

export function sumMoney(values: readonly string[]): string {
  return values.reduce((acc, v) => acc.plus(d(v)), new Decimal(0)).toFixed(2);
}

/** Monthly targets win: when given, the annual figure becomes their sum. */
export function normalizeYearGoal(g: YearGoal): YearGoal {
  return {
    ...g,
    sales: g.monthlySales ? sumMoney(g.monthlySales) : d(g.sales).toFixed(2),
    produced: g.monthlyProduced ? sumMoney(g.monthlyProduced) : d(g.produced).toFixed(2),
    monthlySales: g.monthlySales?.map((v) => d(v).toFixed(2)) ?? null,
    monthlyProduced: g.monthlyProduced?.map((v) => d(v).toFixed(2)) ?? null,
  };
}

export function normalizeGoals(g: Goals): Goals {
  return {
    ...g,
    years: Object.fromEntries(Object.entries(g.years).map(([k, v]) => [k, normalizeYearGoal(v)])),
    longTerm: g.longTerm ? { ...g.longTerm, amount: d(g.longTerm.amount).toFixed(2) } : null,
    excludedLostReasons: [...new Set(g.excludedLostReasons)],
  };
}

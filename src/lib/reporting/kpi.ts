/**
 * Pure KPI maths. Every money and ratio result is a Decimal; callers turn them
 * into strings for the page.
 */
import { daysInMonth, parseIso } from "@/lib/calendar-date";
import { cents, d, Decimal, margin, type DecimalInput } from "@/lib/money";
import { spreadEvenly, type Goals, type YearGoal } from "./goals";
import { fiscalYearOf, monthEnd, monthsIn, overlapDays, type DayRange, type ResolvedPeriod } from "./periods";

export type GoalSeries = "sales" | "produced";
export type Direction = "up_good" | "down_good" | "neutral";

/** n ÷ den, or null when den is 0. */
export function ratio(n: DecimalInput, den: DecimalInput): Decimal | null {
  const dd = d(den);
  return dd.isZero() ? null : d(n).div(dd);
}

/** Change from base to cur; pct is null when base is 0. Null when there is no base. */
export function delta(cur: DecimalInput, base: DecimalInput | null): { abs: Decimal; pct: Decimal | null } | null {
  if (base === null || base === undefined || cur === null || cur === undefined) return null;
  const abs = d(cur).minus(d(base));
  return { abs, pct: ratio(abs, d(base).abs()) };
}

export function deltaTone(abs: Decimal, dir: Direction): "success" | "danger" | "neutral" {
  if (abs.isZero() || dir === "neutral") return "neutral";
  const up = abs.isPositive();
  return up === (dir === "up_good") ? "success" : "danger";
}

/** The 12 monthly goals of a fiscal year (index 0 = first fiscal month), or null without a goal. */
export function monthlyGoals(year: YearGoal | undefined, which: GoalSeries): Decimal[] | null {
  if (!year) return null;
  const monthly = which === "sales" ? year.monthlySales : year.monthlyProduced;
  return (monthly ?? spreadEvenly(which === "sales" ? year.sales : year.produced)).map((v) => d(v));
}

/** The goal for one calendar month ("YYYY-MM-01"), or null when its fiscal year has none. */
export function goalForMonth(goals: Goals, which: GoalSeries, month: string): Decimal | null {
  const { m } = parseIso(month);
  const fy = fiscalYearOf(month, goals.fiscalYearStartMonth);
  const months = monthlyGoals(goals.years[String(fy)], which);
  return months ? months[(m - goals.fiscalYearStartMonth + 12) % 12] : null;
}

/**
 * The goal for a range: each overlapped month's goal prorated by local days of
 * overlap, rounded to cents per month. Null if any overlapped month lacks a goal.
 */
export function goalForRange(goals: Goals, which: GoalSeries, range: DayRange): Decimal | null {
  let total = new Decimal(0);
  for (const month of monthsIn(range)) {
    const goal = goalForMonth(goals, which, month);
    if (!goal) return null;
    const { y, m } = parseIso(month);
    const days = overlapDays(range, { from: month, toInclusive: monthEnd(month) });
    total = total.plus(cents(goal.times(days).div(daysInMonth(y, m))));
  }
  return total;
}

/** Goal-to-date ÷ goal for the whole period, while the period is in progress. */
export function paceFraction(goals: Goals, which: GoalSeries, period: Pick<ResolvedPeriod, "inProgress" | "current" | "full">): Decimal | null {
  if (!period.inProgress) return null;
  const toDate = goalForRange(goals, which, period.current);
  const full = goalForRange(goals, which, period.full);
  return toDate && full ? ratio(toDate, full) : null;
}

/** Weeks of work in the backlog at the recent production rate (the 91 days before). */
export function backlogWeeks(backlog: DecimalInput, produced91d: DecimalInput): Decimal | null {
  const perWeek = d(produced91d).div(13);
  return perWeek.lte(0) ? null : d(backlog).div(perWeek);
}

export function grossMargin(price: DecimalInput, cost: DecimalInput): Decimal | null {
  return d(price).isZero() ? null : margin(price, cost);
}

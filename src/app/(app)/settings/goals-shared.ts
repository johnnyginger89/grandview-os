/**
 * The Goals form's data, and its conversion to the stored goals. Pure: the form
 * uses it for labels and totals, the save action to validate what was posted.
 */
import { z } from "zod";
import { parseIso, type IsoDate } from "@/lib/calendar-date";
import { d } from "@/lib/money";
import { goalMoney, MAX_GOAL_YEARS, spreadEvenly, sumMoney, type Goals, type YearGoal } from "@/lib/reporting/goals";

/** The form posts one JSON field; this caps it before JSON.parse. */
export const GOALS_PAYLOAD_MAX_CHARS = 48_000;
export const MAX_EXCLUDED_REASONS = 20;
export const LONG_TERM_YEARS = { min: 2026, max: 2050 } as const;

const text = (max: number) => z.string().max(max);
const months = z.array(text(40)).length(12);

export const goalsYearInputSchema = z.object({
  year: z.string().regex(/^20\d{2}$/, "Use a year like 2026"),
  sales: text(40),
  produced: text(40),
  sameAsSales: z.boolean(),
  leadsPerMonth: text(20),
  monthly: z.boolean(),
  monthlySales: months,
  monthlyProduced: months,
});

export const goalsPayloadSchema = z.object({
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  years: z.array(goalsYearInputSchema).max(MAX_GOAL_YEARS),
  longTermAmount: text(40),
  longTermYear: text(10),
  excludedLostReasons: z.array(text(100)).max(200),
});

export type GoalsYearInput = z.infer<typeof goalsYearInputSchema>;
export type GoalsPayload = z.infer<typeof goalsPayloadSchema>;

const BLANK_MONTHS: readonly string[] = Array.from({ length: 12 }, () => "");
const monthShort = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" });

export interface FiscalMonth {
  y: number;
  m: number;
  short: string;
  long: string;
}

/** The 12 calendar months of the fiscal year that starts in `startYear`, in order. */
export function fiscalMonths(startYear: number, startMonth: number): FiscalMonth[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m0 = startMonth - 1 + i;
    const y = startYear + Math.floor(m0 / 12);
    const m = (m0 % 12) + 1;
    const at = new Date(Date.UTC(y, m - 1, 1));
    return { y, m, short: monthShort.format(at), long: monthLong.format(at) };
  });
}

/** "2026" for a calendar year; "Apr 2026 – Mar 2027" otherwise. */
export function fiscalYearRange(startYear: number, startMonth: number): string {
  if (startMonth === 1) return String(startYear);
  const ms = fiscalMonths(startYear, startMonth);
  return `${ms[0].short} ${ms[0].y} – ${ms[11].short} ${ms[11].y}`;
}

/** Key of the fiscal year a Vancouver day falls in (the calendar year it starts in). */
export function currentFiscalYear(today: IsoDate, startMonth: number): number {
  const { y, m } = parseIso(today);
  return m >= startMonth ? y : y - 1;
}

/** "$1,200,000", "1 200 000.5" → "1200000.5"; null when it isn't an amount. */
export function cleanAmount(raw: string): string | null {
  const v = raw.replace(/[\s,$]/g, "");
  return goalMoney.safeParse(v).success ? v : null;
}

/** An amount as the owner reads it: "1,000,000" or "83,333.33". */
export function displayAmount(v: string): string {
  const clean = cleanAmount(v);
  if (clean === null) return v;
  const [int, frac] = d(clean).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === "00" ? grouped : `${grouped}.${frac}`;
}

const sameMonths = (a: readonly string[] | null, b: readonly string[] | null) =>
  a === null || b === null ? a === b : a.length === b.length && a.every((v, i) => d(v).eq(d(b[i])));

export function yearToInput(year: string, g: YearGoal | undefined): GoalsYearInput {
  if (!g) return { year, sales: "", produced: "", sameAsSales: true, leadsPerMonth: "", monthly: false, monthlySales: [...BLANK_MONTHS], monthlyProduced: [...BLANK_MONTHS] };
  const monthly = g.monthlySales !== null || g.monthlyProduced !== null;
  const sameAsSales = d(g.sales).eq(d(g.produced)) && (!monthly || sameMonths(g.monthlySales, g.monthlyProduced));
  return {
    year,
    sales: displayAmount(g.sales),
    produced: displayAmount(g.produced),
    sameAsSales,
    leadsPerMonth: g.leadsPerMonth === null ? "" : String(g.leadsPerMonth),
    monthly,
    monthlySales: (monthly ? (g.monthlySales ?? spreadEvenly(g.sales)) : BLANK_MONTHS).map(displayAmount),
    monthlyProduced: (monthly ? (g.monthlyProduced ?? spreadEvenly(g.produced)) : BLANK_MONTHS).map(displayAmount),
  };
}

/** The form's starting state: every saved year plus the current and next fiscal years. */
export function goalsToPayload(g: Goals, today: IsoDate): GoalsPayload {
  const current = currentFiscalYear(today, g.fiscalYearStartMonth);
  const keys = new Set([...Object.keys(g.years), String(current), String(current + 1)]);
  return {
    fiscalYearStartMonth: g.fiscalYearStartMonth,
    years: [...keys].sort().map((k) => yearToInput(k, g.years[k])),
    longTermAmount: g.longTerm ? displayAmount(g.longTerm.amount) : "",
    longTermYear: g.longTerm ? String(g.longTerm.year) : "",
    excludedLostReasons: [...g.excludedLostReasons],
  };
}

function amount(raw: string, what: string): string {
  const v = cleanAmount(raw);
  if (v === null) throw new Error(`${what}: enter an amount like 1000000 or 83333.33.`);
  return v;
}

function total(values: string[], what: string): string {
  const sum = sumMoney(values);
  if (!goalMoney.safeParse(sum).success) throw new Error(`${what} add up to more than the app can store. Check for an extra zero.`);
  return sum;
}

function leads(raw: string, year: string): number | null {
  const v = raw.replace(/[\s,]/g, "");
  if (v === "") return null;
  if (!/^\d{1,6}$/.test(v) || Number(v) > 100_000) throw new Error(`Leads per month for ${year}: enter a whole number, or leave it blank.`);
  return Number(v);
}

/**
 * Turn what the form posted into goals. Throws an Error with a message for the
 * owner when something can't be read. A year whose boxes are all empty is left
 * out, so the dashboard shows no goal for it.
 */
export function payloadToGoals(p: GoalsPayload): Goals {
  const years: Record<string, YearGoal> = {};
  for (const y of p.years) {
    if (years[y.year]) throw new Error(`${y.year} is listed twice. Reload the page and try again.`);
    const ms = fiscalMonths(Number(y.year), p.fiscalYearStartMonth);
    const allBlank = !y.monthly && !y.sales.trim() && (y.sameAsSales || !y.produced.trim()) && !y.leadsPerMonth.trim();
    if (allBlank) continue;
    const leadsPerMonth = leads(y.leadsPerMonth, y.year);
    if (y.monthly) {
      const monthlySales = y.monthlySales.map((v, i) => amount(v, `${ms[i].long} ${ms[i].y} sales target`));
      const monthlyProduced = y.sameAsSales ? monthlySales : y.monthlyProduced.map((v, i) => amount(v, `${ms[i].long} ${ms[i].y} produced target`));
      years[y.year] = {
        sales: total(monthlySales, `The ${y.year} monthly sales targets`),
        produced: total(monthlyProduced, `The ${y.year} monthly produced targets`),
        leadsPerMonth,
        monthlySales,
        monthlyProduced: [...monthlyProduced],
      };
    } else {
      const sales = amount(y.sales, `Sales goal for ${y.year}`);
      years[y.year] = {
        sales,
        produced: y.sameAsSales ? sales : amount(y.produced, `Produced goal for ${y.year}`),
        leadsPerMonth,
        monthlySales: null,
        monthlyProduced: null,
      };
    }
  }

  let longTerm: Goals["longTerm"] = null;
  if (p.longTermAmount.trim()) {
    const yr = p.longTermYear.trim();
    if (!/^\d{4}$/.test(yr) || Number(yr) < LONG_TERM_YEARS.min || Number(yr) > LONG_TERM_YEARS.max)
      throw new Error(`Long-term target: enter a year between ${LONG_TERM_YEARS.min} and ${LONG_TERM_YEARS.max}.`);
    longTerm = { amount: amount(p.longTermAmount, "Long-term target"), year: Number(yr) };
  }

  const excludedLostReasons = [...new Set(p.excludedLostReasons.map((r) => r.trim()).filter(Boolean))];
  if (excludedLostReasons.length > MAX_EXCLUDED_REASONS) throw new Error(`Choose at most ${MAX_EXCLUDED_REASONS} lost reasons to leave out.`);

  return { fiscalYearStartMonth: p.fiscalYearStartMonth, years, longTerm, excludedLostReasons };
}

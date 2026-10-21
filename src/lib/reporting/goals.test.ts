import { describe, expect, it } from "vitest";
import { DEFAULT_GOALS } from "@/db/seed-data";
import { d } from "@/lib/money";
import { goalsSchema, normalizeGoals, spreadEvenly, sumMoney, type Goals, type YearGoal } from "./goals";

const year = (over: Partial<YearGoal> = {}): YearGoal => ({
  sales: "1000000.00",
  produced: "1000000.00",
  leadsPerMonth: null,
  monthlySales: null,
  monthlyProduced: null,
  ...over,
});
const goals = (over: Partial<Goals> = {}): Goals => ({ ...structuredClone(DEFAULT_GOALS), ...over });

describe("goals schema", () => {
  it("accepts the starter values", () => {
    expect(goalsSchema.parse(DEFAULT_GOALS)).toEqual(DEFAULT_GOALS);
    expect(DEFAULT_GOALS.excludedLostReasons).toEqual(["Spam / wrong number"]);
  });

  it("accepts a full year with monthly targets and a lead goal", () => {
    const g = goals({ years: { "2027": year({ leadsPerMonth: 40, monthlySales: spreadEvenly("1200000"), monthlyProduced: spreadEvenly("1100000.5") }) } });
    expect(goalsSchema.safeParse(g).success).toBe(true);
    expect(goalsSchema.safeParse(goals({ longTerm: null, fiscalYearStartMonth: 4 })).success).toBe(true);
  });

  it("rejects bad amounts, month counts, year keys and lists", () => {
    const bad: Goals[] = [
      goals({ years: { "2026": year({ sales: "-5" }) } }),
      goals({ years: { "2026": year({ sales: "1000.005" }) } }),
      goals({ years: { "2026": year({ sales: "1,000,000" }) } }),
      goals({ years: { "2026": year({ monthlySales: [...spreadEvenly("1200"), "100.00"] }) } }),
      goals({ years: { "2026": year({ monthlyProduced: spreadEvenly("1200").slice(1) }) } }),
      goals({ years: { "1999": year() } }),
      goals({ years: { "26": year() } }),
      goals({ excludedLostReasons: Array.from({ length: 21 }, (_, i) => `Reason ${i}`) }),
      goals({ excludedLostReasons: [" "] }),
      goals({ fiscalYearStartMonth: 13 }),
      goals({ longTerm: { amount: "5000000", year: 2051 } }),
      goals({ years: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(2020 + i), year()])) }),
    ];
    for (const g of bad) expect(goalsSchema.safeParse(g).success, JSON.stringify(g).slice(0, 120)).toBe(false);
  });
});

describe("monthly targets", () => {
  it("spreads an annual goal so the months add up exactly", () => {
    const m = spreadEvenly("1000000.00");
    expect(m).toHaveLength(12);
    expect(m.slice(0, 11).every((v) => v === "83333.33")).toBe(true);
    expect(m[11]).toBe("83333.37");
    expect(sumMoney(m)).toBe("1000000.00");
  });

  it("never gives the last month a negative remainder", () => {
    for (const annual of ["0.10", "0.11", "100.06", "999999.99", "0"]) {
      const m = spreadEvenly(annual);
      expect(sumMoney(m), annual).toBe(d(annual).toFixed(2));
      expect(m.every((v) => d(v).gte(0)), annual).toBe(true);
    }
  });

  it("makes the annual figure the sum of monthly targets when they are given", () => {
    const monthly = [...Array(11).fill("50000"), "100000.5"];
    const n = normalizeGoals(goals({ years: { "2026": year({ sales: "1", monthlySales: monthly }) }, excludedLostReasons: ["Spam / wrong number", "Spam / wrong number"] }));
    expect(n.years["2026"].sales).toBe("650000.50");
    expect(n.years["2026"].monthlySales?.[11]).toBe("100000.50");
    expect(n.years["2026"].produced).toBe("1000000.00");
    expect(n.excludedLostReasons).toEqual(["Spam / wrong number"]);
  });
});

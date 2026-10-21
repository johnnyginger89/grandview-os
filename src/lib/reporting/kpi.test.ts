import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/money";
import type { Goals } from "./goals";
import { backlogWeeks, delta, deltaTone, goalForMonth, goalForRange, grossMargin, monthlyGoals, paceFraction, ratio } from "./kpi";
import { resolvePeriod } from "./periods";

const GOALS: Goals = {
  fiscalYearStartMonth: 1,
  years: { "2026": { sales: "1000000.00", produced: "1000000.00", leadsPerMonth: null, monthlySales: null, monthlyProduced: null } },
  longTerm: { amount: "5000000.00", year: 2030 },
  excludedLostReasons: ["Spam / wrong number"],
};
const NOW = new Date("2026-10-20T19:00:00Z");

describe("ratio and delta", () => {
  it("ratio is null for a zero denominator and a Decimal otherwise", () => {
    expect(ratio(5, 0)).toBeNull();
    const r = ratio(6, 13);
    expect(r).toBeInstanceOf(Decimal);
    expect(r!.toFixed(4)).toBe("0.4615");
  });

  it("delta has no pct when the base is 0, and is null without a base", () => {
    expect(delta("10", "0")).toEqual({ abs: new Decimal(10), pct: null });
    expect(delta("10", null)).toBeNull();
    const dd = delta("84200.00", "74900.00")!;
    expect(dd.abs.toFixed(2)).toBe("9300.00");
    expect(dd.pct!.toFixed(4)).toBe("0.1242");
  });

  it("a negative base gives a pct relative to its size", () => {
    expect(delta("-50", "-100")!.pct!.toFixed(2)).toBe("0.50");
  });

  it("deltaTone follows direction × whether up is good", () => {
    expect(deltaTone(new Decimal(5), "up_good")).toBe("success");
    expect(deltaTone(new Decimal(-5), "up_good")).toBe("danger");
    expect(deltaTone(new Decimal(5), "down_good")).toBe("danger");
    expect(deltaTone(new Decimal(-5), "down_good")).toBe("success");
    expect(deltaTone(new Decimal(5), "neutral")).toBe("neutral");
    expect(deltaTone(new Decimal(0), "up_good")).toBe("neutral");
  });
});

describe("goals", () => {
  it("monthlyGoals spreads the annual goal: 11 × 83,333.33 + 83,333.37", () => {
    const months = monthlyGoals(GOALS.years["2026"], "sales")!;
    expect(months.map((m) => m.toFixed(2))).toEqual([...Array(11).fill("83333.33"), "83333.37"]);
    expect(months.reduce((a, b) => a.plus(b), new Decimal(0)).toFixed(2)).toBe("1000000.00");
    expect(monthlyGoals(undefined, "sales")).toBeNull();
  });

  it("monthly targets win, indexed from the first fiscal month", () => {
    const monthlySales = Array.from({ length: 12 }, (_, i) => `${(i + 1) * 1000}.00`);
    const goals: Goals = { ...GOALS, fiscalYearStartMonth: 4, years: { "2026": { ...GOALS.years["2026"], monthlySales } } };
    expect(goalForMonth(goals, "sales", "2026-04-01")!.toFixed(2)).toBe("1000.00");
    expect(goalForMonth(goals, "sales", "2027-03-01")!.toFixed(2)).toBe("12000.00");
    expect(goalForMonth(goals, "sales", "2026-03-01")).toBeNull(); // fiscal 2025 has no goal
  });

  it("goalForRange prorates by local days: Oct 1–20 = 53,763.44", () => {
    const g = goalForRange(GOALS, "sales", { from: "2026-10-01", toInclusive: "2026-10-20" });
    expect(g).toBeInstanceOf(Decimal);
    expect(g!.toFixed(2)).toBe("53763.44");
  });

  it("YTD goal-to-date on Oct 20 = 803,763.41; pace marker at 80.4%", () => {
    const { period } = resolvePeriod({ preset: "ytd", compare: "ly" }, NOW, { fiscalYearStartMonth: 1 });
    expect(goalForRange(GOALS, "sales", period.current)!.toFixed(2)).toBe("803763.41");
    expect(goalForRange(GOALS, "sales", period.full)!.toFixed(2)).toBe("1000000.00");
    expect(paceFraction(GOALS, "sales", period)!.toFixed(3)).toBe("0.804");
  });

  it("a range overlapping a year without a goal has no goal", () => {
    expect(goalForRange(GOALS, "sales", { from: "2026-12-01", toInclusive: "2027-01-31" })).toBeNull();
    expect(goalForRange(GOALS, "sales", { from: "2025-11-01", toInclusive: "2026-10-20" })).toBeNull();
  });

  it("pace is null once the period is over", () => {
    const { period } = resolvePeriod({ preset: "last_month", compare: "prior" }, NOW, { fiscalYearStartMonth: 1 });
    expect(paceFraction(GOALS, "sales", period)).toBeNull();
  });
});

describe("backlog weeks and margin", () => {
  it("backlogWeeks divides by 13 weeks of production; null without production", () => {
    expect(backlogWeeks("130000", "130000")!.toFixed(1)).toBe("13.0");
    expect(backlogWeeks("412300", "595000")!.toFixed(1)).toBe("9.0");
    expect(backlogWeeks("412300", "0")).toBeNull();
  });

  it("grossMargin is null for a zero price and a Decimal otherwise", () => {
    expect(grossMargin("0", "100")).toBeNull();
    const m = grossMargin("10000", "5280");
    expect(m).toBeInstanceOf(Decimal);
    expect(m!.toFixed(4)).toBe("0.4720");
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_GOALS } from "@/db/seed-data";
import { goalsSchema, normalizeGoals, spreadEvenly, sumMoney } from "@/lib/reporting/goals";
import {
  cleanAmount,
  currentFiscalYear,
  displayAmount,
  fiscalMonths,
  fiscalYearRange,
  goalsPayloadSchema,
  goalsToPayload,
  payloadToGoals,
  yearToInput,
  type GoalsPayload,
} from "./goals-shared";

const TODAY = "2026-10-21";
const start = (): GoalsPayload => goalsToPayload(structuredClone(DEFAULT_GOALS), TODAY);
const withYear = (p: GoalsPayload, year: string, patch: Partial<GoalsPayload["years"][number]>): GoalsPayload => ({
  ...p,
  years: p.years.map((y) => (y.year === year ? { ...y, ...patch } : y)),
});
/** What saveGoals stores. */
const stored = (p: GoalsPayload) => goalsSchema.parse(normalizeGoals(goalsSchema.parse(payloadToGoals(p))));

describe("fiscal months", () => {
  it("labels a calendar year and a fiscal year that crosses into the next", () => {
    expect(fiscalMonths(2026, 1).map((m) => m.short)).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    const apr = fiscalMonths(2026, 4);
    expect(apr[0]).toMatchObject({ y: 2026, m: 4, long: "April" });
    expect(apr[11]).toMatchObject({ y: 2027, m: 3, long: "March" });
    expect(fiscalYearRange(2026, 1)).toBe("2026");
    expect(fiscalYearRange(2026, 4)).toBe("Apr 2026 – Mar 2027");
  });

  it("finds the current fiscal year from a Vancouver day", () => {
    expect(currentFiscalYear(TODAY, 1)).toBe(2026);
    expect(currentFiscalYear(TODAY, 10)).toBe(2026);
    expect(currentFiscalYear(TODAY, 11)).toBe(2025);
    expect(currentFiscalYear("2027-01-01", 4)).toBe(2026);
  });
});

describe("amounts", () => {
  it("accepts what an owner types and rejects what isn't money", () => {
    expect(cleanAmount("$1,200,000")).toBe("1200000");
    expect(cleanAmount(" 83 333.33 ")).toBe("83333.33");
    for (const bad of ["", "-5", "1000.005", "abc", "1e6", "12345678901"]) expect(cleanAmount(bad), bad).toBeNull();
  });

  it("displays amounts with thousands separators and no empty cents", () => {
    expect(displayAmount("1000000.00")).toBe("1,000,000");
    expect(displayAmount("83333.33")).toBe("83,333.33");
    expect(displayAmount("0")).toBe("0");
    expect(displayAmount("oops")).toBe("oops");
  });
});

describe("goals ⇄ form", () => {
  it("starts from the saved goals plus the current and next fiscal year", () => {
    const p = start();
    expect(goalsPayloadSchema.safeParse(p).success).toBe(true);
    expect(p.years.map((y) => y.year)).toEqual(["2026", "2027"]);
    expect(p.years[0]).toMatchObject({ sales: "1,000,000", produced: "1,000,000", sameAsSales: true, monthly: false, leadsPerMonth: "" });
    expect(p.years[1]).toMatchObject({ sales: "", produced: "", sameAsSales: true, monthly: false });
    expect(p).toMatchObject({ fiscalYearStartMonth: 1, longTermAmount: "5,000,000", longTermYear: "2030", excludedLostReasons: ["Spam / wrong number"] });
  });

  it("saves the starter values unchanged and leaves an empty year out", () => {
    expect(stored(start())).toEqual(DEFAULT_GOALS);
  });

  it("saves a new sales goal, copying it to produced when ticked", () => {
    const g = stored(withYear(start(), "2026", { sales: "1,200,000" }));
    expect(g.years["2026"]).toEqual({ sales: "1200000.00", produced: "1200000.00", leadsPerMonth: null, monthlySales: null, monthlyProduced: null });
    const own = stored(withYear(start(), "2026", { sales: "1200000", sameAsSales: false, produced: "900000", leadsPerMonth: "45" }));
    expect(own.years["2026"]).toMatchObject({ sales: "1200000.00", produced: "900000.00", leadsPerMonth: 45 });
  });

  it("lets monthly targets win over the year figure", () => {
    const months = spreadEvenly("1200000");
    months[6] = "150000";
    const g = stored(withYear(start(), "2027", { sales: "1", monthly: true, monthlySales: months }));
    expect(g.years["2027"].sales).toBe(sumMoney(months));
    expect(g.years["2027"].monthlyProduced).toEqual(g.years["2027"].monthlySales);
    expect(g.years["2027"].produced).toBe(g.years["2027"].sales);
  });

  it("round-trips a year with its own monthly produced targets", () => {
    const year = { sales: "1200000.00", produced: "1100000.00", leadsPerMonth: 30, monthlySales: spreadEvenly("1200000"), monthlyProduced: spreadEvenly("1100000") };
    const input = yearToInput("2026", year);
    expect(input).toMatchObject({ sameAsSales: false, monthly: true });
    const p = { ...start(), years: [input] };
    expect(stored(p).years["2026"]).toEqual(year);
  });

  it("keeps the fiscal start month and the long-term target", () => {
    const g = stored({ ...start(), fiscalYearStartMonth: 4, longTermAmount: "7,500,000", longTermYear: "2032" });
    expect(g.fiscalYearStartMonth).toBe(4);
    expect(g.longTerm).toEqual({ amount: "7500000.00", year: 2032 });
    expect(stored({ ...start(), longTermAmount: " ", longTermYear: "2030" }).longTerm).toBeNull();
  });

  it("de-duplicates lost reasons", () => {
    expect(stored({ ...start(), excludedLostReasons: ["Price", " Price ", "Spam / wrong number", ""] }).excludedLostReasons).toEqual(["Price", "Spam / wrong number"]);
  });
});

describe("goals form errors read as plain English", () => {
  const fails = (p: GoalsPayload) => {
    try {
      payloadToGoals(p);
    } catch (e) {
      return (e as Error).message;
    }
    return null;
  };

  it("names the year or month that needs fixing", () => {
    expect(fails(withYear(start(), "2026", { sales: "lots" }))).toMatch(/^Sales goal for 2026: enter an amount/);
    expect(fails(withYear(start(), "2026", { sameAsSales: false, produced: "" }))).toMatch(/^Produced goal for 2026/);
    expect(fails(withYear(start(), "2027", { leadsPerMonth: "40" }))).toMatch(/^Sales goal for 2027/);
    expect(fails(withYear(start(), "2026", { leadsPerMonth: "4.5" }))).toMatch(/^Leads per month for 2026/);
    const months = spreadEvenly("1200000");
    months[11] = "";
    expect(fails({ ...withYear(start(), "2026", { monthly: true, monthlySales: months }), fiscalYearStartMonth: 4 })).toMatch(/^March 2027 sales target/);
    expect(fails(withYear(start(), "2026", { monthly: true, monthlySales: Array(12).fill("9999999999") }))).toMatch(/add up to more than/);
  });

  it("checks the long-term year, the reasons limit and duplicate years", () => {
    expect(fails({ ...start(), longTermYear: "2051" })).toMatch(/^Long-term target: enter a year between 2026 and 2050/);
    expect(fails({ ...start(), longTermYear: "" })).toMatch(/^Long-term target/);
    expect(fails({ ...start(), excludedLostReasons: Array.from({ length: 21 }, (_, i) => `Reason ${i}`) })).toMatch(/at most 20/);
    const p = start();
    expect(fails({ ...p, years: [p.years[0], p.years[0]] })).toMatch(/listed twice/);
  });

  it("rejects malformed posts at the schema", () => {
    expect(goalsPayloadSchema.safeParse({ ...start(), years: [{ ...start().years[0], monthlySales: ["1"] }] }).success).toBe(false);
    expect(goalsPayloadSchema.safeParse({ ...start(), fiscalYearStartMonth: 13 }).success).toBe(false);
    expect(goalsPayloadSchema.safeParse({ ...start(), years: [{ ...start().years[0], year: "1999" }] }).success).toBe(false);
  });
});

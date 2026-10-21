import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Goals } from "@/lib/reporting/goals";

const sent: { sql: string; params: unknown[] }[] = [];
const dialect = new PgDialect();

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
  db: {
    execute: async (q: SQL) => {
      sent.push(dialect.sqlToQuery(q));
      return { rows: [{}] };
    },
  },
}));
vi.mock("./leads", () => ({ channelLabel: (c: string | null) => c ?? "manual entry" }));
vi.mock("./goals", () => ({ getGoals: async () => GOALS }));

const GOALS: Goals = {
  fiscalYearStartMonth: 1,
  years: { "2026": { sales: "1000000.00", produced: "1000000.00", leadsPerMonth: null, monthlySales: null, monthlyProduced: null } },
  longTerm: { amount: "5000000.00", year: 2030 },
  excludedLostReasons: ["Spam / wrong number"],
};

const { accessFor, getMonthSnapshot, getPerformance } = await import("./dashboard");
const { resolvePeriod } = await import("@/lib/reporting/periods");

const NOW = new Date("2026-10-20T19:00:00Z");
const PERIOD = resolvePeriod({ preset: "this_month", compare: "prior" }, NOW, { fiscalYearStartMonth: 1 }).period;
const COMPANY_MONEY = /contract_price|estimated_cost/;
const QUOTE_MONEY = /totals|estimated_value/;

beforeEach(() => {
  sent.length = 0;
});

describe("accessFor", () => {
  it("company money for owner and operations manager; pipeline value for every office role", () => {
    expect(accessFor("owner")).toEqual({ money: true, pipelineMoney: true });
    expect(accessFor("operations_manager")).toEqual({ money: true, pipelineMoney: true });
    expect(accessFor("admin")).toEqual({ money: false, pipelineMoney: true });
    expect(accessFor("estimator")).toEqual({ money: false, pipelineMoney: true });
    expect(accessFor("project_manager")).toEqual({ money: false, pipelineMoney: true });
    expect(accessFor("painter")).toEqual({ money: false, pipelineMoney: false });
  });
});

describe("getPerformance SQL", () => {
  it("count-only roles never read a money column", async () => {
    const dto = await getPerformance(PERIOD, { money: false, pipelineMoney: false }, { now: NOW });
    expect(sent).toHaveLength(9);
    for (const q of sent) {
      expect(q.sql).not.toMatch(COMPANY_MONEY);
      expect(q.sql).not.toMatch(QUOTE_MONEY);
    }
    expect("money" in dto).toBe(false);
  });

  it("estimates.read reads quote values for the open pipeline only", async () => {
    await getPerformance(PERIOD, { money: false, pipelineMoney: true }, { now: NOW });
    for (const q of sent) expect(q.sql).not.toMatch(COMPANY_MONEY);
    expect(sent.filter((q) => QUOTE_MONEY.test(q.sql))).toHaveLength(1);
    expect(sent.find((q) => QUOTE_MONEY.test(q.sql))!.sql).toContain("open_est");
  });

  it("financials.read reads contract prices", async () => {
    const dto = await getPerformance(PERIOD, { money: true, pipelineMoney: true }, { now: NOW });
    expect(sent.some((q) => COMPANY_MONEY.test(q.sql))).toBe(true);
    expect(dto.money?.sales.value).toBe("0.00");
  });

  it("binds instants and the zone as parameters and never sets the session time zone", async () => {
    await getPerformance(PERIOD, { money: true, pipelineMoney: true }, { now: NOW });
    const all = sent.map((q) => q.sql).join("\n");
    expect(all).not.toMatch(/set\s+(local\s+)?time\s*zone/i);
    expect(all).not.toContain("2026-10-01");
    const params = sent.flatMap((q) => q.params);
    expect(params).toContain("2026-10-01T07:00:00.000Z");
    expect(params).toContain("2026-10-21T07:00:00.000Z");
    expect(params).toContain("America/Vancouver");
    expect(params).toContainEqual(["Spam / wrong number"]);
  });
});

describe("getMonthSnapshot", () => {
  it("runs five queries and keeps money out for count roles", async () => {
    const s = await getMonthSnapshot(NOW, { money: false, pipelineMoney: false });
    expect(sent).toHaveLength(5);
    for (const q of sent) expect(q.sql).not.toMatch(COMPANY_MONEY);
    expect("money" in s).toBe(false);
    expect(s.period.currentLabel).toBe("Oct 1–20");
  });
});

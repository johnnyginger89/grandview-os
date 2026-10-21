import { describe, expect, it } from "vitest";
import { buildPerformanceDTO, buildSnapshotDTO, compareAvailable, goalProgress, OTHER_SOURCE, type DtoContext, type RawPerformance } from "./dto";
import type { Goals } from "./goals";
import { resolvePeriod } from "./periods";

const NOW = new Date("2026-10-20T19:00:00Z");
const GOALS: Goals = {
  fiscalYearStartMonth: 1,
  years: { "2026": { sales: "1000000.00", produced: "1000000.00", leadsPerMonth: null, monthlySales: null, monthlyProduced: null } },
  longTerm: { amount: "5000000.00", year: 2030 },
  excludedLostReasons: ["Spam / wrong number"],
};
const period = (preset: "this_month" | "ytd" | "last_month" = "this_month") => resolvePeriod({ preset, compare: "prior" }, NOW, { fiscalYearStartMonth: 1 }).period;

const pair = <T>(cur: T, cmp: T) => ({ cur, cmp });

/** Raw rows as a money query returns them; the builder must drop money when the viewer can't see it. */
function raw(): RawPerformance {
  return {
    projects: {
      soldN: pair(23, 20),
      completedN: pair(9, 11),
      cancelledN: pair(1, 0),
      backlogN: pair(38, 35),
      onHoldN: 2,
      cycleMedian: pair("19.0", "21.5"),
      cycleMean: pair("23.4", "25.0"),
      money: {
        sales: pair("84200.00", "74900.00"),
        soldCost: pair("44458.00", "40000.00"),
        produced: pair("61200.00", "63100.00"),
        cancelled: pair("2900.00", "0"),
        backlog: pair("412300.00", "398000.00"),
        onHold: "18400.00",
        produced91d: pair("595000.00", "560000.00"),
        trailing12: "910000.00",
      },
    },
    opps: {
      leads: pair(64, 57),
      visitsBooked: pair(31, 30),
      visitsCompleted: pair(28, 26),
      won: pair(6, 5),
      lost: pair(7, 8),
      money: { wonValue: pair("24000.00", "20000.00"), lostValue: pair("34500.00", "38000.00") },
    },
    proposals: { sentN: pair(26, 22), sentValue: pair("141000.00", "120000.00") },
    monthly: [
      { k: "sold", m: "2026-10", n: 23, v: "84200.00" },
      { k: "produced", m: "2026-10", n: 9, v: "61200.00" },
      { k: "leads", m: "2026-10", n: 64, v: null },
      { k: "sold", m: "2026-03", n: 4, v: "12000.00" },
    ],
    sources: [
      ...Array.from({ length: 10 }, (_, i) => ({ dim: "source" as const, key: `Source ${i + 1}`, n: 20 - i, nCmp: 3, v: null })),
      { dim: "source", key: OTHER_SOURCE, n: 2, nCmp: 0, v: null },
      { dim: "channel", key: "phone", n: 40, nCmp: 30, v: null },
      { dim: "channel", key: "manual", n: 24, nCmp: 27, v: null },
      { dim: "sold", key: "Source 1", n: 6, nCmp: 0, v: "24000.00" },
      { dim: "sold", key: "Source 10", n: 1, nCmp: 0, v: "5000.00" },
    ],
    lost: [{ reason: "Price", n: 7, quoted: "38000.00" }],
    people: [
      { ownerId: null, name: null, k: "sold", n: 2, v: "3000.00" },
      { ownerId: "u1", name: "Jordan Estimator", k: "visits", n: 12, v: null },
      { ownerId: "u1", name: "Jordan Estimator", k: "proposals", n: 10, v: "60000.00" },
      { ownerId: "u1", name: "Jordan Estimator", k: "sold", n: 5, v: "20000.00" },
      { ownerId: "u1", name: "Jordan Estimator", k: "won", n: 6, v: null },
      { ownerId: "u1", name: "Jordan Estimator", k: "lost", n: 7, v: null },
      { ownerId: "u2", name: "Sam Owner", k: "sold", n: 3, v: "30000.00" },
    ],
    pipeline: { proposalsOut: 18, proposalsOutValue: "96000.00", notQuoted: 23, notQuotedValue: "41000.00" },
  };
}

const ctx = (over: Partial<DtoContext> = {}): DtoContext => ({
  money: true,
  pipelineMoney: true,
  period: period(),
  goals: GOALS,
  dataStartsAt: new Date("2024-01-01T08:00:00Z"),
  channelLabel: (k) => (k === "manual" ? "Manual entry" : k === "phone" ? "Phone" : k),
  ...over,
});

const MONEY_KEYS = ["money", "soldValue", "quotedValue", "proposalsValue", "averageSale", "proposalsOutValue", "notQuotedEstimatedValue", "sales", "produced", "backlog", "goals", "salesGoal"];

function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  return out;
}

describe("buildPerformanceDTO: money only for those who may see it", () => {
  it("without financials.read or estimates.read there is no money anywhere", () => {
    const dto = buildPerformanceDTO(raw(), ctx({ money: false, pipelineMoney: false }));
    expect("money" in dto).toBe(false);
    const keys = keysDeep(dto);
    for (const k of MONEY_KEYS) expect(keys.has(k), k).toBe(false);
    const json = JSON.stringify(dto);
    for (const amount of ["84200", "61200", "412300", "141000", "96000", "38000", "24000", "30000"]) expect(json).not.toContain(amount);
    expect(json).not.toContain('"produced"');
    expect(json).not.toContain('"key":"sales"');
  });

  it("estimates.read alone adds the pipeline value and nothing else", () => {
    const dto = buildPerformanceDTO(raw(), ctx({ money: false, pipelineMoney: true }));
    expect(dto.pipeline).toEqual({ proposalsOut: 18, proposalsOutValue: "96000.00", notQuoted: 23, notQuotedEstimatedValue: "41000.00" });
    expect("money" in dto).toBe(false);
    const keys = keysDeep(dto);
    for (const k of ["soldValue", "quotedValue", "proposalsValue", "averageSale", "salesGoal"]) expect(keys.has(k), k).toBe(false);
  });

  it("financials.read gets every money figure as a decimal string", () => {
    const dto = buildPerformanceDTO(raw(), ctx());
    const m = dto.money!;
    expect(m.sales).toEqual({ value: "84200.00", compare: "74900.00", compareAvailable: true });
    expect(m.netSales.value).toBe("81300.00");
    expect(m.averageSale.value).toBe("3660.87");
    expect(m.grossMargin.value).toBe("0.4720");
    expect(m.backlogWeeks.value).toBe("9.0");
    expect(m.closeRateValue.value).toBe("0.4103");
    expect(m.backlogOnHold).toBe("18400.00");
    expect(m.goals.runRate).toEqual({ trailing12: "910000.00", target: "5000000.00", year: 2030, pct: "0.1820" });
    expect(dto.sources[0].soldValue).toBe("24000.00");
    expect(dto.lostReasons[0].quotedValue).toBe("38000.00");
    expect(dto.monthly.money!.sales[11]).toBe("84200.00");
    expect(dto.monthly.money!.salesGoal[0]).toBeNull(); // Nov 2025: no 2025 goal
    expect(dto.monthly.money!.salesGoal[11]).toBe("83333.33"); // October; December takes the remainder
  });
});

describe("buildPerformanceDTO: shaping", () => {
  it("close rate 6/13 → 0.4615; counts are strings", () => {
    const dto = buildPerformanceDTO(raw(), ctx({ money: false }));
    expect(dto.counts.closeRate.value).toBe("0.4615");
    expect(dto.counts.leads).toEqual({ value: "64", compare: "57", compareAvailable: true });
    expect(dto.counts.salesCycleMedianDays.value).toBe("19.0");
    expect(dto.counts.backlogOnHoldJobs).toBe(2);
  });

  it("zero-fills the 12 chart months", () => {
    const dto = buildPerformanceDTO(raw(), ctx({ money: false }));
    expect(dto.monthly.months).toHaveLength(12);
    expect(dto.monthly.months[11]).toEqual({ key: "2026-10", label: "Oct", year: 2026, inPeriod: true });
    expect(dto.monthly.months[10].inPeriod).toBe(false);
    expect(dto.monthly.jobsSold).toEqual([0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 23]);
    expect(dto.monthly.leads.filter((n) => n > 0)).toEqual([64]);
  });

  it("folds sources past the top 8 into Other, which stays last", () => {
    const dto = buildPerformanceDTO(raw(), ctx());
    expect(dto.sources.map((s) => s.key)).toEqual(["Source 1", "Source 2", "Source 3", "Source 4", "Source 5", "Source 6", "Source 7", "Source 8", OTHER_SOURCE]);
    const other = dto.sources[8];
    expect(other.leads).toBe(12 + 11 + 2);
    expect(other.leadsCompare).toBe(6);
    expect(other.sold).toBe(1);
    expect(other.soldValue).toBe("5000.00");
  });

  it("labels channels", () => {
    expect(buildPerformanceDTO(raw(), ctx()).channels.map((c) => c.label)).toEqual(["Phone", "Manual entry"]);
  });

  it("funnel steps carry the rate from the step above", () => {
    const f = buildPerformanceDTO(raw(), ctx()).funnel;
    expect(f.map((s) => [s.key, s.count, s.stepRate])).toEqual([
      ["leads", 64, null],
      ["visitsBooked", 31, "0.4844"],
      ["visitsCompleted", 28, "0.9032"],
      ["proposalsSent", 26, "0.9286"],
      ["jobsSold", 23, "0.8846"],
    ]);
  });

  it("people: one row per salesperson, Unassigned last, close rate per person", () => {
    const people = buildPerformanceDTO(raw(), ctx()).people;
    expect(people.map((p) => p.name)).toEqual(["Sam Owner", "Jordan Estimator", "Unassigned"]);
    const jordan = people[1];
    expect(jordan).toMatchObject({ visitsCompleted: 12, proposalsSent: 10, proposalsValue: "60000.00", jobsSold: 5, soldValue: "20000.00", closeRate: "0.4615", averageSale: "4000.00" });
    const counts = buildPerformanceDTO(raw(), ctx({ money: false })).people;
    expect(counts.map((p) => p.name)).toEqual(["Jordan Estimator", "Sam Owner", "Unassigned"]);
    expect(Object.keys(counts[0]).sort()).toEqual(["closeRate", "jobsSold", "name", "proposalsSent", "userId", "visitsCompleted"]);
  });
});

describe("comparisons and goals", () => {
  it("comparisons are unavailable when the comparison starts before the first record", () => {
    const p = period();
    expect(compareAvailable(p, new Date("2026-09-01T07:00:00Z"))).toBe(true);
    expect(compareAvailable(p, new Date("2026-09-03T07:00:00Z"))).toBe(false);
    expect(compareAvailable(p, null)).toBe(false);
    const dto = buildPerformanceDTO(raw(), ctx({ dataStartsAt: new Date("2026-10-03T17:00:00Z") }));
    expect(dto.counts.leads.compareAvailable).toBe(false);
    expect(dto.money!.sales.compareAvailable).toBe(false);
    expect(dto.sources[0].leadsCompare).toBeNull();
    expect(dto.dataStartsAt).toBe("2026-10-03");
  });

  it("goal progress this month: pace from the goal to date", () => {
    const onPace = goalProgress("53763.44", GOALS, "sales", period())!;
    expect(onPace).toMatchObject({ goal: "83333.33", goalToDate: "53763.44", pct: "0.6452", pace: "0.6452", status: "on_pace", shortBy: "0.00" });
    const behind = goalProgress("20000.00", GOALS, "sales", period())!;
    expect(behind).toMatchObject({ status: "behind", shortBy: "33763.44" });
    expect(goalProgress("80000.00", GOALS, "sales", period())!.status).toBe("ahead");
  });

  it("goal progress for a finished period has no pace", () => {
    const done = goalProgress("90000.00", GOALS, "sales", period("last_month"))!;
    expect(done).toMatchObject({ pace: null, status: "complete", shortBy: "0.00", pct: "1.0800" });
    expect(goalProgress("50000.00", GOALS, "sales", period("last_month"))!.shortBy).toBe("33333.33");
  });

  it("no goal → null; YTD uses the year's goal", () => {
    const noGoals: Goals = { ...GOALS, years: {} };
    expect(goalProgress("1", noGoals, "sales", period())).toBeNull();
    const ytd = buildPerformanceDTO(raw(), ctx({ period: period("ytd") }));
    expect(ytd.money!.goals.sales!.goal).toBe("1000000.00");
    expect(ytd.period.goalName).toBe("goal for 2026");
  });
});

describe("buildSnapshotDTO", () => {
  it("counts only without financials.read", () => {
    const s = buildSnapshotDTO(raw(), ctx({ money: false, pipelineMoney: true }));
    expect("money" in s).toBe(false);
    expect(s.counts.jobsSold.value).toBe("23");
    expect(s.pipeline.proposalsOutValue).toBe("96000.00");
    expect(JSON.stringify(s)).not.toContain("84200");
  });

  it("money tiles and the month goal with financials.read", () => {
    const s = buildSnapshotDTO(raw(), ctx());
    expect(s.money).toMatchObject({ backlog: "412300.00", backlogJobs: 38, backlogWeeks: "9.0" });
    expect(s.money!.sales.value).toBe("84200.00");
    expect(s.money!.salesGoal).toMatchObject({ goal: "83333.33", status: "ahead" });
    expect(s.period.goalName).toBe("goal for October");
  });
});

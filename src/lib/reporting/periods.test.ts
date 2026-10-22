import { describe, expect, it } from "vitest";
import { addMonthsClamped, customRangeError, rangeLabel, resolvePeriod, shiftMonths, type PeriodInput, type Range, type ResolvedPeriod } from "./periods";

// Oct 20 2026, 12:00 PDT: the fixture the spec's worked examples use.
const NOW = new Date("2026-10-20T19:00:00Z");

function resolve(input: Partial<PeriodInput> & { preset: PeriodInput["preset"] }, now = NOW, fsm = 1): ResolvedPeriod {
  const r = resolvePeriod({ compare: "prior", ...input }, now, { fiscalYearStartMonth: fsm });
  if (!r.ok) throw new Error(r.error);
  return r.period;
}

const iso = (r: Range) => [r.start.toISOString(), r.end.toISOString()];
const days = (r: { from: string; toInclusive: string }) => [r.from, r.toInclusive];

describe("resolvePeriod: the worked examples (now = Oct 20 2026, 12:00 PDT)", () => {
  it("this month: Oct 1–20, ending at the start of tomorrow", () => {
    const p = resolve({ preset: "this_month" });
    expect(iso(p.current)).toEqual(["2026-10-01T07:00:00.000Z", "2026-10-21T07:00:00.000Z"]);
    expect(p.current.label).toBe("Oct 1–20");
    expect(days(p.comparison)).toEqual(["2026-09-01", "2026-09-20"]);
    expect(iso(p.comparison)).toEqual(["2026-09-01T07:00:00.000Z", "2026-09-21T07:00:00.000Z"]);
    expect(days(p.lastYear)).toEqual(["2025-10-01", "2025-10-20"]);
    expect(p.lastYear.label).toBe("Oct 1–20, 2025");
    expect(days(p.full)).toEqual(["2026-10-01", "2026-10-31"]);
    expect(p.inProgress).toBe(true);
    expect(p.asOf).toEqual(NOW);
    expect(p.elapsedFraction).toBeCloseTo(20 / 31, 10);
  });

  it("this month compared with last year", () => {
    const p = resolve({ preset: "this_month", compare: "ly" });
    expect(p.compare).toBe("ly");
    expect(iso(p.comparison)).toEqual(["2025-10-01T07:00:00.000Z", "2025-10-21T07:00:00.000Z"]);
  });

  it("last month: all of September; previous is August; last year is Sep 2025", () => {
    const p = resolve({ preset: "last_month" });
    expect(iso(p.current)).toEqual(["2026-09-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z"]);
    expect(days(p.comparison)).toEqual(["2026-08-01", "2026-08-31"]);
    expect(days(p.lastYear)).toEqual(["2025-09-01", "2025-09-30"]);
    expect(p.inProgress).toBe(false);
    expect(p.asOf).toEqual(p.current.end);
    expect(p.elapsedFraction).toBeNull();
  });

  it("quarter to date: Oct 1–20 against the same 20 days of the previous quarter", () => {
    const p = resolve({ preset: "qtd" });
    expect(days(p.current)).toEqual(["2026-10-01", "2026-10-20"]);
    expect(days(p.comparison)).toEqual(["2026-07-01", "2026-07-20"]);
    expect(days(p.lastYear)).toEqual(["2025-10-01", "2025-10-20"]);
    expect(days(p.full)).toEqual(["2026-10-01", "2026-12-31"]);
  });

  it("year to date: Jan 1–Oct 20, compare forced to last year", () => {
    const p = resolve({ preset: "ytd", compare: "prior" });
    expect(iso(p.current)).toEqual(["2026-01-01T08:00:00.000Z", "2026-10-21T07:00:00.000Z"]);
    expect(p.compare).toBe("ly");
    expect(iso(p.comparison)).toEqual(["2025-01-01T08:00:00.000Z", "2025-10-21T07:00:00.000Z"]);
    expect(days(p.full)).toEqual(["2026-01-01", "2026-12-31"]);
    expect(p.fiscalYear).toBe(2026);
  });

  it("last 12 months: 11 full months plus this month to date, compare forced to last year", () => {
    const p = resolve({ preset: "l12m" });
    expect(iso(p.current)).toEqual(["2025-11-01T07:00:00.000Z", "2026-10-21T07:00:00.000Z"]);
    expect(p.compare).toBe("ly");
    expect(days(p.comparison)).toEqual(["2024-11-01", "2025-10-20"]);
    expect(p.current.label).toBe("Nov 1, 2025 – Oct 20, 2026");
  });

  it("custom Jun 1–Aug 31: previous is the 92 days before; last year is Jun 1–Aug 31 2025", () => {
    const p = resolve({ preset: "custom", from: "2026-06-01", to: "2026-08-31" });
    expect(iso(p.current)).toEqual(["2026-06-01T07:00:00.000Z", "2026-09-01T07:00:00.000Z"]);
    expect((p.current.end.getTime() - p.current.start.getTime()) / 86_400_000).toBe(92);
    expect(days(p.comparison)).toEqual(["2026-03-01", "2026-05-31"]);
    // March 1 is still standard time (DST starts Mar 8 2026).
    expect(p.comparison.start.toISOString()).toBe("2026-03-01T08:00:00.000Z");
    expect(days(p.lastYear)).toEqual(["2025-06-01", "2025-08-31"]);
    expect(p.inProgress).toBe(false);
    expect(p.current.label).toBe("Jun 1 – Aug 31");
  });

  it("12 chart months end with the month the range ends in", () => {
    expect(resolve({ preset: "this_month" }).chartMonths).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    const custom = resolve({ preset: "custom", from: "2026-06-01", to: "2026-08-31" });
    expect(custom.chartMonths[0]).toBe("2025-09");
    expect(custom.chartMonths[11]).toBe("2026-08");
    expect(custom.chartWindow.start.toISOString()).toBe("2025-09-01T07:00:00.000Z");
    expect(custom.chartWindow.end.toISOString()).toBe("2026-09-01T07:00:00.000Z");
  });
});

describe("resolvePeriod: edge cases", () => {
  it("DST end (Nov 2025): Nov 1 midnight is still PDT, Dec 1 is PST", () => {
    const nov = resolve({ preset: "this_month" }, new Date("2025-11-15T20:00:00Z"));
    expect(nov.current.start.toISOString()).toBe("2025-11-01T07:00:00.000Z");
    expect(nov.current.end.toISOString()).toBe("2025-11-16T08:00:00.000Z");
    const dec = resolve({ preset: "last_month" }, new Date("2025-12-15T20:00:00Z"));
    expect(iso(dec.current)).toEqual(["2025-11-01T07:00:00.000Z", "2025-12-01T08:00:00.000Z"]);
  });

  it("from Nov 2026 British Columbia stays on UTC−7", () => {
    const nov = resolve({ preset: "this_month" }, new Date("2026-11-15T20:00:00Z"));
    expect(nov.current.start.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(nov.current.end.toISOString()).toBe("2026-11-16T07:00:00.000Z");
    const dec = resolve({ preset: "last_month" }, new Date("2026-12-15T20:00:00Z"));
    expect(iso(dec.current)).toEqual(["2026-11-01T07:00:00.000Z", "2026-12-01T07:00:00.000Z"]);
  });

  it("DST start: March 2026 starts in PST and today ends in PDT", () => {
    const p = resolve({ preset: "this_month" }, new Date("2026-03-20T19:00:00Z"));
    expect(iso(p.current)).toEqual(["2026-03-01T08:00:00.000Z", "2026-03-21T07:00:00.000Z"]);
  });

  it("23:30 on Oct 31 local (06:30 UTC Nov 1) is still October", () => {
    const p = resolve({ preset: "this_month" }, new Date("2026-11-01T06:30:00Z"));
    expect(days(p.current)).toEqual(["2026-10-01", "2026-10-31"]);
    expect(iso(p.current)).toEqual(["2026-10-01T07:00:00.000Z", "2026-11-01T07:00:00.000Z"]);
    expect(p.current.label).toBe("Oct 1–31");
  });

  it("short-month clamp: on Mar 30 the previous to-date period is Feb 1–28", () => {
    const p = resolve({ preset: "this_month" }, new Date("2026-03-30T19:00:00Z"));
    expect(days(p.comparison)).toEqual(["2026-02-01", "2026-02-28"]);
  });

  it("leap day: last year of 2028-02-29 is 2027-02-28; whole Februaries stay whole", () => {
    const p = resolve({ preset: "this_month" }, new Date("2028-02-29T20:00:00Z"));
    expect(days(p.current)).toEqual(["2028-02-01", "2028-02-29"]);
    expect(days(p.lastYear)).toEqual(["2027-02-01", "2027-02-28"]);
    const feb2029 = resolve({ preset: "last_month" }, new Date("2029-03-10T20:00:00Z"));
    expect(days(feb2029.lastYear)).toEqual(["2028-02-01", "2028-02-29"]);
  });

  it("quarter to date never runs past the end of the previous quarter", () => {
    const p = resolve({ preset: "qtd" }, new Date("2026-06-30T19:00:00Z"));
    expect(days(p.current)).toEqual(["2026-04-01", "2026-06-30"]);
    expect(days(p.comparison)).toEqual(["2026-01-01", "2026-03-31"]);
  });

  it("fiscal year starting in April: QTD Oct 1–20, YTD Apr 1–Oct 20, fiscal year 2026", () => {
    const qtd = resolve({ preset: "qtd" }, NOW, 4);
    expect(days(qtd.current)).toEqual(["2026-10-01", "2026-10-20"]);
    const ytd = resolve({ preset: "ytd" }, NOW, 4);
    expect(days(ytd.current)).toEqual(["2026-04-01", "2026-10-20"]);
    expect(days(ytd.full)).toEqual(["2026-04-01", "2027-03-31"]);
    expect(ytd.fiscalYear).toBe(2026);
    const feb = resolve({ preset: "ytd" }, new Date("2027-02-10T20:00:00Z"), 4);
    expect(days(feb.current)).toEqual(["2026-04-01", "2027-02-10"]);
    expect(feb.fiscalYear).toBe(2026);
    const febQ = resolve({ preset: "qtd" }, new Date("2027-02-10T20:00:00Z"), 4);
    expect(days(febQ.current)).toEqual(["2027-01-01", "2027-02-10"]);
  });

  it("an invalid fiscal start month falls back to January", () => {
    expect(days(resolve({ preset: "ytd" }, NOW, 13).current)).toEqual(["2026-01-01", "2026-10-20"]);
  });

  it("a custom range ending today is in progress", () => {
    const p = resolve({ preset: "custom", from: "2026-10-01", to: "2026-10-20" });
    expect(p.inProgress).toBe(true);
    expect(p.asOf).toEqual(NOW);
  });
});

describe("custom range validation", () => {
  const bad = (from: string | undefined, to: string | undefined) => {
    const r = resolvePeriod({ preset: "custom", compare: "prior", from, to }, NOW, { fiscalYearStartMonth: 1 });
    expect(r.ok).toBe(false);
    expect(r.period.preset).toBe("this_month");
    expect(days(r.period.current)).toEqual(["2026-10-01", "2026-10-20"]);
    return r.ok ? "" : r.error;
  };

  it("rejects from after to, with the message the page shows", () => {
    expect(bad("2026-08-31", "2026-06-01")).toBe("End date must be on or after the start date.");
  });
  it("rejects an end date in the future", () => {
    expect(bad("2026-10-01", "2026-10-21")).toBe("End date can't be in the future.");
  });
  it("rejects a span over 3 years", () => {
    expect(bad("2020-01-01", "2023-01-01")).toBe("Choose a range of 3 years or less.");
    expect(customRangeError("2020-01-01", "2022-12-31", "2026-10-20")).toBeNull();
  });
  it("rejects dates before 2015", () => {
    expect(bad("2014-12-31", "2015-06-01")).toBe("Start date can't be before 2015.");
  });
  it("rejects impossible and missing dates", () => {
    expect(bad("2026-02-30", "2026-03-10")).toBe("Enter real dates, like 2026-06-01.");
    expect(bad(undefined, "2026-03-10")).toBe("Choose a start date and an end date.");
  });
});

describe("calendar helpers", () => {
  it("addMonthsClamped clamps to the month's last day", () => {
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-03-31", -1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-01-15", -13)).toBe("2024-12-15");
    expect(addMonthsClamped("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("shiftMonths keeps whole months whole", () => {
    expect(shiftMonths({ from: "2026-09-01", toInclusive: "2026-09-30" }, -1)).toEqual({ from: "2026-08-01", toInclusive: "2026-08-31" });
    expect(shiftMonths({ from: "2026-10-01", toInclusive: "2026-10-20" }, -1)).toEqual({ from: "2026-09-01", toInclusive: "2026-09-20" });
  });

  it("rangeLabel shows the year only when it isn't the reference year", () => {
    expect(rangeLabel({ from: "2026-10-01", toInclusive: "2026-10-20" }, 2026)).toBe("Oct 1–20");
    expect(rangeLabel({ from: "2026-10-01", toInclusive: "2026-10-20" }, 2027)).toBe("Oct 1–20, 2026");
    expect(rangeLabel({ from: "2026-07-01", toInclusive: "2026-10-20" }, 2026)).toBe("Jul 1 – Oct 20");
    expect(rangeLabel({ from: "2025-11-01", toInclusive: "2026-10-20" }, 2026)).toBe("Nov 1, 2025 – Oct 20, 2026");
    expect(rangeLabel({ from: "2026-10-20", toInclusive: "2026-10-20" }, 2026)).toBe("Oct 20");
  });
});

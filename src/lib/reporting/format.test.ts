import { describe, expect, it } from "vitest";
import { formatCADCompact, formatCADWhole, formatDays, formatPctPoints, formatRatio, formatWeeks, niceTicks, signed, truncate } from "./format";
import { performanceHref } from "./periods";
import { performanceQuerySchema } from "./query";

describe("format", () => {
  it("whole and compact dollars", () => {
    expect(formatCADWhole("1200000.00")).toBe("$1,200,000");
    expect(formatCADWhole("83333.33")).toBe("$83,333");
    expect(formatCADWhole("-2900.00")).toBe("−$2,900");
    expect(formatCADCompact("84200.00")).toBe("$84.2K");
    expect(formatCADCompact("950")).toBe("$950");
    expect(formatCADCompact("1250000")).toBe("$1.3M");
  });

  it("ratios, points, days and weeks", () => {
    expect(formatRatio("0.4615")).toBe("46%");
    expect(formatRatio("0.4615", 1)).toBe("46.2%");
    expect(formatRatio(null)).toBe("—");
    expect(formatPctPoints("0.042")).toBe("+4.2 pts");
    expect(formatPctPoints("-0.015")).toBe("−1.5 pts");
    expect(formatDays("1.0")).toBe("1 day");
    expect(formatDays("18.6")).toBe("19 days");
    expect(formatDays(null)).toBe("—");
    expect(formatWeeks("9.04")).toBe("~9 weeks");
  });

  it("signed adds + or − and never doubles a sign", () => {
    expect(signed("5", "5")).toBe("+5");
    expect(signed("-5", "5")).toBe("−5");
    expect(signed("-5", "-5")).toBe("−5");
    expect(signed("0", "0")).toBe("0");
  });

  it("niceTicks gives 4 round ticks that cover the max", () => {
    expect(niceTicks(84200)).toEqual([0, 30000, 60000, 90000]);
    expect(niceTicks(1_000_000)).toEqual([0, 400000, 800000, 1200000]);
    expect(niceTicks(30000)).toEqual([0, 10000, 20000, 30000]);
    expect(niceTicks(2, { integer: true })).toEqual([0, 1, 2, 3]);
    expect(niceTicks(23, { integer: true })).toEqual([0, 8, 16, 24]);
    expect(niceTicks(0)).toEqual([0, 1, 2, 3]);
    for (const max of [1, 7, 99, 101, 5555, 83333.37, 1e7]) expect(niceTicks(max)[3]).toBeGreaterThanOrEqual(max);
  });

  it("truncate keeps short text and cuts long text", () => {
    expect(truncate("Price")).toBe("Price");
    expect(truncate("x".repeat(80))).toHaveLength(60);
  });
});

describe("performanceQuerySchema", () => {
  it("parses a valid query", () => {
    expect(performanceQuerySchema.parse({ period: "custom", compare: "ly", from: "2026-06-01", to: "2026-08-31" })).toEqual({ period: "custom", compare: "ly", from: "2026-06-01", to: "2026-08-31" });
  });

  it("falls back to defaults instead of failing", () => {
    expect(performanceQuerySchema.parse({})).toEqual({ period: "this_month", compare: "prior" });
    expect(performanceQuerySchema.parse({ period: "forever", compare: ["ly", "prior"], from: "June 1", to: "2026-8-31", other: "x" })).toEqual({
      period: "this_month",
      compare: "prior",
      from: undefined,
      to: undefined,
    });
  });

  it("performanceHref leaves defaults out", () => {
    expect(performanceHref({ period: "last_month" })).toBe("/performance?period=last_month");
    expect(performanceHref({ period: "qtd", compare: "ly", from: "2026-01-01" })).toBe("/performance?period=qtd&compare=ly");
    expect(performanceHref({ period: "custom", from: "2026-06-01", to: "2026-08-31" })).toBe("/performance?period=custom&from=2026-06-01&to=2026-08-31");
  });
});

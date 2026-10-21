import { describe, expect, it } from "vitest";
import { addDays, eachDay, formatIsoDate, isIsoDate, isoToInstant, maxIso, minIso, mondayOf, monthGrid, startOfMonth, startOfWeek, todayIso } from "./dates";

describe("schedule dates", () => {
  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("rejects impossible dates", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-10-26")).toBe(true);
  });

  it("computes today in Vancouver, not UTC", () => {
    expect(todayIso(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10-31");
  });

  it("maps a calendar day to Vancouver midnight across DST", () => {
    expect(isoToInstant("2026-11-01").toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(isoToInstant("2026-03-08").toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });

  it("formats a calendar day independently of the process time zone", () => {
    const prev = process.env.TZ;
    try {
      for (const tz of ["Pacific/Auckland", "UTC", "America/Vancouver"]) {
        process.env.TZ = tz;
        expect(formatIsoDate("2026-10-26", { weekday: "long", month: "long", day: "numeric" })).toBe("Monday, October 26");
      }
    } finally {
      process.env.TZ = prev;
    }
  });

  it("lists days inclusively and refuses huge ranges", () => {
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(eachDay("2026-11-02", "2026-10-30")).toEqual([]);
    expect(() => eachDay("2026-01-01", "2028-01-01")).toThrow(RangeError);
  });

  it("finds week starts", () => {
    expect(startOfWeek("2026-10-25", 1)).toBe("2026-10-19"); // Sunday → previous Monday
    expect(startOfWeek("2026-10-25", 0)).toBe("2026-10-25");
    expect(startOfWeek("2026-10-21", 0)).toBe("2026-10-18");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
    expect(mondayOf("2026-10-30")).toBe("2026-10-26");
    expect(startOfMonth("2026-10-21")).toBe("2026-10-01");
  });

  it("builds a 6 × 7 month grid", () => {
    const g = monthGrid(2026, 10, 1);
    expect(g).toHaveLength(6);
    expect(g.every((r) => r.length === 7)).toBe(true);
    expect(g[0][0]).toBe("2026-09-28");
    expect(g[5][6]).toBe("2026-11-08");
    expect(monthGrid(2026, 10, 0)[0][0]).toBe("2026-09-27");
  });

  it("picks min and max days", () => {
    expect(minIso("2026-10-26", "2026-10-02")).toBe("2026-10-02");
    expect(maxIso("2026-10-26", "2026-10-02")).toBe("2026-10-26");
  });
});

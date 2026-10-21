import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  businessDate,
  dayOfWeek,
  dayRangeInstants,
  diffDays,
  formatIsoDate,
  isIsoDate,
  isoToInstant,
  parseIso,
  todayIso,
  toIso,
} from "./calendar-date";

const iso = (d: Date) => d.toISOString();

/** Fixtures that must hold whatever time zone the process runs in. */
function zoneIndependentFixtures() {
  it("rejects dates that don't exist", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2100-02-29")).toBe(false);
    expect(isIsoDate("2026-04-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-00-10")).toBe(false);
    expect(isIsoDate("2026-1-05")).toBe(false);
    expect(isIsoDate(" 2026-10-20")).toBe(false);
    expect(isIsoDate(20261020)).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2000-02-29")).toBe(true);
    expect(() => parseIso("2026-02-30")).toThrow(RangeError);
    expect(() => toIso({ y: 2026, m: 2, d: 30 })).toThrow(RangeError);
    expect(() => isoToInstant("2026-02-30")).toThrow(RangeError);
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });

  it("does calendar math without DST drift", () => {
    expect(parseIso("2026-10-20")).toEqual({ y: 2026, m: 10, d: 20 });
    expect(toIso({ y: 2026, m: 3, d: 8 })).toBe("2026-03-08");
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(diffDays("2026-03-01", "2026-04-01")).toBe(31);
    expect(diffDays("2026-10-01", "2026-12-01")).toBe(61);
    expect(diffDays("2026-11-02", "2026-11-01")).toBe(-1);
    expect(diffDays("2026-06-01", "2026-06-01")).toBe(0);
    expect(dayOfWeek("2026-10-20")).toBe(2);
    expect(dayOfWeek("2026-11-01")).toBe(0);
  });

  it("finds the Vancouver day of an instant, including 23:30 local / next day UTC", () => {
    expect(businessDate(new Date("2026-11-01T06:30:00Z"))).toBe("2026-10-31");
    expect(businessDate("2026-11-01T06:30:00.000Z")).toBe("2026-10-31");
    expect(businessDate(new Date("2026-11-01T07:00:00Z"))).toBe("2026-11-01");
    expect(todayIso(new Date("2026-10-20T19:00:00Z"))).toBe("2026-10-20");
    expect(todayIso(new Date("2026-10-21T06:59:59Z"))).toBe("2026-10-20");
    // Bare wall-clock strings are Vancouver time, never server time.
    expect(businessDate("2026-10-31T23:30")).toBe("2026-10-31");
    expect(businessDate("2026-10-20")).toBe("2026-10-20");
    expect(() => businessDate("next tuesday-ish")).toThrow(RangeError);
    expect(() => businessDate(new Date(Number.NaN))).toThrow(RangeError);
  });

  it("handles the autumn DST change (Nov 1 2026, 02:00 PDT → 01:00 PST)", () => {
    expect(iso(isoToInstant("2026-11-01"))).toBe("2026-11-01T07:00:00.000Z");
    expect(iso(isoToInstant("2026-11-02"))).toBe("2026-11-02T08:00:00.000Z");
    expect(iso(isoToInstant("2026-12-01"))).toBe("2026-12-01T08:00:00.000Z");
    // 01:30 happens twice; both are Nov 1.
    expect(businessDate(new Date("2026-11-01T08:30:00Z"))).toBe("2026-11-01");
    expect(businessDate(new Date("2026-11-01T09:30:00Z"))).toBe("2026-11-01");
    expect(businessDate(new Date("2026-11-02T07:59:00Z"))).toBe("2026-11-01");
    expect(businessDate(new Date("2026-11-02T08:00:00Z"))).toBe("2026-11-02");
    const r = dayRangeInstants("2026-11-01", "2026-11-01");
    expect(r.end.getTime() - r.start.getTime()).toBe(25 * 3_600_000);
  });

  it("handles the spring DST change (Mar 8 2026, 02:00 PST → 03:00 PDT)", () => {
    expect(iso(isoToInstant("2026-03-08"))).toBe("2026-03-08T08:00:00.000Z");
    expect(iso(isoToInstant("2026-03-09"))).toBe("2026-03-09T07:00:00.000Z");
    expect(businessDate(new Date("2026-03-08T07:59:00Z"))).toBe("2026-03-07");
    expect(businessDate(new Date("2026-03-09T06:59:00Z"))).toBe("2026-03-08");
    expect(businessDate(new Date("2026-03-09T07:00:00Z"))).toBe("2026-03-09");
    const r = dayRangeInstants("2026-03-08", "2026-03-08");
    expect(r.end.getTime() - r.start.getTime()).toBe(23 * 3_600_000);
  });

  it("converts wall-clock times on a day to instants", () => {
    expect(iso(isoToInstant("2026-10-14", "12:00"))).toBe("2026-10-14T19:00:00.000Z");
    expect(iso(isoToInstant("2026-11-01", "12:00"))).toBe("2026-11-01T20:00:00.000Z");
    expect(iso(isoToInstant("2026-10-31", "23:30"))).toBe("2026-11-01T06:30:00.000Z");
    expect(() => isoToInstant("2026-10-14", "24:00")).toThrow(RangeError);
    expect(() => isoToInstant("2026-10-14", "9:00")).toThrow(RangeError);
    const r = dayRangeInstants("2026-10-01", "2026-10-31");
    expect([iso(r.start), iso(r.end)]).toEqual(["2026-10-01T07:00:00.000Z", "2026-11-01T07:00:00.000Z"]);
  });

  it("round-trips every day of two years through an instant", () => {
    let day = "2026-01-01";
    for (let i = 0; i < 731; i++) {
      const start = isoToInstant(day);
      expect(businessDate(start), day).toBe(day);
      expect(businessDate(isoToInstant(day, "23:59")), day).toBe(day);
      const hours = (isoToInstant(addDays(day, 1)).getTime() - start.getTime()) / 3_600_000;
      expect([23, 24, 25], day).toContain(hours);
      day = addDays(day, 1);
    }
    expect(day).toBe("2028-01-02");
  });

  it("formats a calendar day without shifting it", () => {
    expect(formatIsoDate("2026-10-14")).toBe("Oct 14, 2026");
    expect(formatIsoDate("2026-11-01", { weekday: "short", month: "short", day: "numeric" })).toBe("Sun, Nov 1");
    expect(formatIsoDate("2026-01-01", { dateStyle: "medium", timeZone: "Pacific/Auckland" })).toBe("Jan 1, 2026");
  });
}

describe("calendar-date (process TZ as configured)", () => {
  zoneIndependentFixtures();
});

describe("calendar-date under TZ=Pacific/Auckland", () => {
  const before = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Pacific/Auckland";
  });
  afterAll(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });
  it("really runs in Auckland time", () => {
    // NZDT is UTC+13 in January; this guards against the TZ switch silently not applying.
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-780);
  });
  zoneIndependentFixtures();
});

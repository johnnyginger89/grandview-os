import { describe, expect, it } from "vitest";
import { bcStatHolidays, closedDaysBetween, closedDayTitle, easterSunday } from "./holidays";

const dates = (year: number) => bcStatHolidays(year).map((h) => h.date);

describe("BC statutory holidays", () => {
  it("matches the BC government table for 2026", () => {
    expect(dates(2026)).toEqual([
      "2026-01-01", "2026-02-16", "2026-04-03", "2026-05-18", "2026-07-01", "2026-08-03",
      "2026-09-07", "2026-09-30", "2026-10-12", "2026-11-11", "2026-12-25",
    ]);
  });

  it("matches the BC government table for 2027", () => {
    expect(dates(2027)).toEqual([
      "2027-01-01", "2027-02-15", "2027-03-26", "2027-05-24", "2027-07-01", "2027-08-02",
      "2027-09-06", "2027-09-30", "2027-10-11", "2027-11-11", "2027-12-25",
    ]);
  });

  it("computes Easter Sunday", () => {
    expect([2025, 2026, 2027, 2028].map(easterSunday)).toEqual(["2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16"]);
  });

  it("observes Canada Day on July 2 when July 1 is a Sunday (2029)", () => {
    const h = bcStatHolidays(2029);
    expect(h.find((x) => x.date === "2029-07-02")?.label).toBe("Canada Day (observed)");
    expect(bcStatHolidays(2026).some((x) => x.label.includes("observed"))).toBe(false);
  });

  it("has no Boxing Day or Easter Monday", () => {
    for (const year of [2026, 2027, 2028]) {
      const h = bcStatHolidays(year);
      expect(h.some((x) => x.date.endsWith("-12-26"))).toBe(false);
      const easterMonday = easterSunday(year).replace(/\d{2}$/, (d) => String(Number(d) + 1).padStart(2, "0"));
      expect(h.some((x) => x.date === easterMonday)).toBe(false);
      expect(h.every((x) => x.source === "bc_stat")).toBe(true);
    }
  });

  it("labels Thanksgiving for headers and tooltips", () => {
    const t = bcStatHolidays(2026).find((x) => x.date === "2026-10-12")!;
    expect(t.short).toBe("Thanksgiving");
    expect(closedDayTitle(t)).toBe("Thanksgiving Day – BC statutory holiday");
  });
});

describe("closedDaysBetween", () => {
  const settings = { holidayRegion: "BC" as const, extraClosedDays: [{ date: "2026-12-28", label: "Christmas shutdown" }, { date: "2026-12-25", label: "Dup" }] };

  it("merges company closed days with stats in range, stats winning on the same day", () => {
    const m = closedDaysBetween("2026-12-20", "2027-01-05", settings);
    expect([...m.keys()].sort()).toEqual(["2026-12-25", "2026-12-28", "2027-01-01"]);
    expect(m.get("2026-12-28")).toEqual({ date: "2026-12-28", label: "Christmas shutdown", short: "Christmas shutdown", source: "company" });
    expect(m.get("2026-12-25")?.source).toBe("bc_stat");
    expect(closedDayTitle(m.get("2026-12-28")!)).toBe("Christmas shutdown – company closed");
  });

  it("drops BC days for holidayRegion none and returns nothing for a reversed range", () => {
    const m = closedDaysBetween("2026-12-20", "2027-01-05", { ...settings, holidayRegion: "none" });
    expect([...m.keys()].sort()).toEqual(["2026-12-25", "2026-12-28"]);
    expect(m.get("2026-12-25")).toMatchObject({ label: "Dup", source: "company" });
    expect(closedDaysBetween("2026-12-31", "2026-12-01", settings).size).toBe(0);
  });
});

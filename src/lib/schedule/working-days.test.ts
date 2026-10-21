import { describe, expect, it } from "vitest";
import { closedDaysBetween } from "./holidays";
import { defaultScheduleSettings } from "./settings-schema";
import { addWorkingDays, calendarsFor, countWorkingDays, crewCalendar, isWorkingDay, nextWorkingDay, nonWorkingDaysIn } from "./working-days";

const settings = defaultScheduleSettings();
const closed = closedDaysBetween("2026-01-01", "2027-12-31", settings);
const cal = crewCalendar(settings, null, closed);
const satCal = crewCalendar(settings, { worksSaturdays: true }, closed);

describe("working days", () => {
  it("skips the weekend and Thanksgiving", () => {
    // Thu Oct 8 → Fri Oct 9 → (Sat, Sun, Thanksgiving Mon) → Tue Oct 13.
    expect(addWorkingDays("2026-10-08", 3, cal)).toBe("2026-10-13");
    expect(isWorkingDay("2026-10-12", cal)).toBe(false);
  });

  it("snaps a Saturday start to Monday", () => {
    expect(nextWorkingDay("2026-10-24", cal)).toBe("2026-10-26");
    expect(addWorkingDays("2026-10-24", 1, cal)).toBe("2026-10-26");
    expect(nextWorkingDay("2026-10-26", cal)).toBe("2026-10-26");
  });

  it("counts Saturday for a crew that works Saturdays", () => {
    expect(nextWorkingDay("2026-10-24", satCal)).toBe("2026-10-24");
    expect(countWorkingDays("2026-10-19", "2026-10-25", satCal)).toBe(6);
    expect(countWorkingDays("2026-10-19", "2026-10-25", cal)).toBe(5);
  });

  it("counts a Christmas shutdown and the stats in between", () => {
    const shut = { ...settings, extraClosedDays: ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"].map((date) => ({ date, label: "Christmas shutdown" })) };
    const { calFor } = calendarsFor(shut, "2026-12-01", "2027-01-31");
    // Dec 21–24 and Jan 4; Christmas Day and New Year's Day are stats.
    expect(countWorkingDays("2026-12-21", "2027-01-04", calFor(null))).toBe(5);
    expect(countWorkingDays("2026-12-21", "2026-12-20", calFor(null))).toBe(0);
  });

  it("explains non-working days", () => {
    expect(nonWorkingDaysIn("2026-10-09", "2026-10-13", cal)).toEqual([
      { date: "2026-10-10", label: "Saturday" },
      { date: "2026-10-11", label: "Sunday" },
      { date: "2026-10-12", label: "Thanksgiving Day" },
    ]);
  });

  it("treats n below 1 as one day and reuses calendars per crew", () => {
    expect(addWorkingDays("2026-10-26", 0, cal)).toBe("2026-10-26");
    const { calFor } = calendarsFor(settings, "2026-10-01", "2026-10-31");
    expect(calFor(null)).toBe(calFor({ worksSaturdays: false }));
    expect(calFor({ worksSaturdays: true }).workDays.has(6)).toBe(true);
  });
});

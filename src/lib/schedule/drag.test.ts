import { describe, expect, it } from "vitest";
import { applyCreate, applyMove, applyResize, dayIndexFromX } from "./drag";
import { closedDaysBetween } from "./holidays";
import { defaultScheduleSettings } from "./settings-schema";
import { countWorkingDays, crewCalendar } from "./working-days";

const settings = defaultScheduleSettings();
const closed = closedDaysBetween("2026-01-01", "2026-12-31", settings);
const cal = crewCalendar(settings, null, closed);
const satCal = crewCalendar(settings, { worksSaturdays: true }, closed);

describe("drag math", () => {
  it("clamps the column under the pointer", () => {
    expect(dayIndexFromX(95, 100, 40, 14)).toBe(0);
    expect(dayIndexFromX(141, 100, 40, 14)).toBe(1);
    expect(dayIndexFromX(5000, 100, 40, 14)).toBe(13);
    expect(dayIndexFromX(120, 100, 0, 14)).toBe(0);
  });

  it("moves keeping the working-day count", () => {
    // Mon–Fri +1 → Tue → next Mon.
    expect(applyMove({ startDate: "2026-10-19", endDate: "2026-10-23" }, 1, cal, cal)).toEqual({ startDate: "2026-10-20", endDate: "2026-10-26" });
  });

  it("moves across Thanksgiving", () => {
    const r = applyMove({ startDate: "2026-10-05", endDate: "2026-10-07" }, 3, cal, cal); // Mon–Wed → Thu Oct 8
    expect(r).toEqual({ startDate: "2026-10-08", endDate: "2026-10-13" });
    expect(countWorkingDays(r.startDate, r.endDate, cal)).toBe(3);
  });

  it("recalculates on a Saturday-working crew", () => {
    // Thu–Mon (3 working days) moved to a crew that works Saturdays: Thu, Fri, Sat.
    expect(applyMove({ startDate: "2026-10-22", endDate: "2026-10-26" }, 0, cal, satCal)).toEqual({ startDate: "2026-10-22", endDate: "2026-10-24" });
  });

  it("snaps a move that lands on a weekend", () => {
    expect(applyMove({ startDate: "2026-10-21", endDate: "2026-10-22" }, 3, cal, cal)).toEqual({ startDate: "2026-10-26", endDate: "2026-10-27" });
  });

  it("moves a weekend-only booking as-is", () => {
    expect(applyMove({ startDate: "2026-10-24", endDate: "2026-10-24" }, 7, cal, cal)).toEqual({ startDate: "2026-10-31", endDate: "2026-10-31" });
  });

  it("resizes without crossing", () => {
    const b = { startDate: "2026-10-26", endDate: "2026-10-28" };
    expect(applyResize(b, "end", -10)).toEqual({ startDate: "2026-10-26", endDate: "2026-10-26" });
    expect(applyResize(b, "start", 10)).toEqual({ startDate: "2026-10-28", endDate: "2026-10-28" });
    expect(applyResize(b, "end", 2)).toEqual({ startDate: "2026-10-26", endDate: "2026-10-30" });
    expect(applyResize(b, "start", -1)).toEqual({ startDate: "2026-10-25", endDate: "2026-10-28" });
    expect(applyResize(b, "end", 400).endDate).toBe("2027-04-24");
  });

  it("creates from a Saturday drop by snapping to Monday", () => {
    expect(applyCreate("2026-10-24", 2, cal)).toEqual({ startDate: "2026-10-26", endDate: "2026-10-27" });
    expect(applyCreate("2026-10-24", 1, satCal)).toEqual({ startDate: "2026-10-24", endDate: "2026-10-24" });
  });
});

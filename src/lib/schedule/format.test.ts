import { describe, expect, it } from "vitest";
import { CREW_COLORS } from "./constants";
import { CREW_COLOR_CLASSES, crewColorClasses } from "./colors";
import { dateRangeLabel, entryAriaLabel, jobTitle, kindLabel, longDay, shortDay, workingDaysLabel } from "./format";

describe("schedule format", () => {
  it("derives the job title", () => {
    expect(jobTitle("[TEST DATA] Kim – Exterior repaint", null)).toBe("Exterior repaint");
    expect(jobTitle("[TEST DATA] Kim – Exterior repaint", " Exterior + deck ")).toBe("Exterior + deck");
    expect(jobTitle("Plain name")).toBe("Plain name");
  });

  it("formats days and ranges", () => {
    expect(shortDay("2026-10-26")).toBe("Mon, Oct 26");
    expect(longDay("2026-10-26")).toBe("Monday, October 26");
    expect(dateRangeLabel("2026-10-26", "2026-10-27")).toBe("Mon, Oct 26 – Tue, Oct 27");
    expect(dateRangeLabel("2026-10-26", "2026-10-26")).toBe("Mon, Oct 26");
    expect(workingDaysLabel(1)).toBe("1 working day");
    expect(workingDaysLabel(5)).toBe("5 working days");
    expect(kindLabel("pressure_wash")).toBe("Pressure wash");
  });

  it("builds the bar's accessible name", () => {
    expect(
      entryAriaLabel({ projectNumber: 3018, customerName: "[TEST DATA] Kim", kind: "work", crewName: "Niko", startDate: "2026-10-26", endDate: "2026-10-27", workingDays: 2, tentative: true }),
    ).toBe("Job 3018, [TEST DATA] Kim, painting, Niko, Monday, October 26 to Tuesday, October 27, 2 working days, tentative");
  });

  it("has static classes for every palette colour", () => {
    for (const c of CREW_COLORS) {
      const cls = CREW_COLOR_CLASSES[c];
      expect(cls.dot).toMatch(new RegExp(`^bg-${c}-\\d+$`));
      expect(cls.border).toMatch(new RegExp(`^border-l-${c}-\\d+$`));
    }
    expect(crewColorClasses("nope")).toBe(crewColorClasses(null));
  });
});

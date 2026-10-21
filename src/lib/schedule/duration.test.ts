import { describe, expect, it } from "vitest";
import { crewDayHours, entryHours, remainingHours, splitHours, suggestedWorkingDays } from "./duration";

const three = { crewSize: 3, hoursPerDay: "8" };

describe("durations", () => {
  it("suggests whole working days, rounding up", () => {
    expect(suggestedWorkingDays("120", three)).toBe(5);
    expect(suggestedWorkingDays("100", three)).toBe(5); // 4.17 → 4.5 → 5
    expect(suggestedWorkingDays("42", three)).toBe(2);
    expect(suggestedWorkingDays("0", three)).toBe(1);
    expect(suggestedWorkingDays(null, three)).toBe(1);
    expect(suggestedWorkingDays("-5", three)).toBe(1);
    expect(suggestedWorkingDays("100000", three)).toBe(120);
  });

  it("uses Decimal for fractional hours per day", () => {
    const two = { crewSize: 2, hoursPerDay: "7.5" };
    expect(crewDayHours(two).toString()).toBe("15");
    expect(suggestedWorkingDays("45", two)).toBe(3);
    expect(suggestedWorkingDays("45.01", two)).toBe(4); // 3.0007 → 3.5 → 4
    expect(crewDayHours({ crewSize: 3, hoursPerDay: "0.1" }).toString()).toBe("0.3");
  });

  it("never reports negative remaining hours", () => {
    expect(remainingHours("40", "48").toString()).toBe("0");
    expect(remainingHours("42.5", "24").toString()).toBe("18.5");
  });

  it("counts planned hours when set, otherwise days × crew capacity", () => {
    expect(entryHours({ plannedHours: "12.50", workingDays: 5 }, three, three).toString()).toBe("12.5");
    expect(entryHours({ plannedHours: null, workingDays: 2 }, three, three).toString()).toBe("48");
    expect(entryHours({ plannedHours: null, workingDays: 2 }, null, { crewSize: 2, hoursPerDay: "8" }).toString()).toBe("32");
  });

  it("splits hours by working-day share to the cent", () => {
    expect(splitHours("12.00", 3, 2)).toEqual(["7.20", "4.80"]);
    expect(splitHours("10", 1, 2)).toEqual(["3.33", "6.67"]);
    expect(splitHours("9", 0, 0)).toEqual(["4.50", "4.50"]);
  });
});

import { describe, expect, it } from "vitest";
import { monthGrid } from "./dates";
import { barGeometry, monthSegments } from "./layout";

const win = { from: "2026-10-19", days: 14 };

describe("barGeometry", () => {
  it("places a bar inside the window", () => {
    expect(barGeometry({ startDate: "2026-10-20", endDate: "2026-10-22" }, win)).toEqual({ col: 1, span: 3, clipStart: false, clipEnd: false });
  });

  it("clips at both window edges", () => {
    expect(barGeometry({ startDate: "2026-10-15", endDate: "2026-11-10" }, win)).toEqual({ col: 0, span: 14, clipStart: true, clipEnd: true });
    expect(barGeometry({ startDate: "2026-10-30", endDate: "2026-11-04" }, win)).toEqual({ col: 11, span: 3, clipStart: false, clipEnd: true });
  });

  it("returns null outside the window", () => {
    expect(barGeometry({ startDate: "2026-10-01", endDate: "2026-10-18" }, win)).toBeNull();
    expect(barGeometry({ startDate: "2026-11-02", endDate: "2026-11-03" }, win)).toBeNull();
  });
});

describe("monthSegments", () => {
  it("splits a booking across week rows with continuation flags", () => {
    const grid = monthGrid(2026, 10, 1);
    expect(monthSegments({ startDate: "2026-10-08", endDate: "2026-10-14" }, grid)).toEqual([
      { row: 1, col: 3, span: 4, clipStart: false, clipEnd: true },
      { row: 2, col: 0, span: 3, clipStart: true, clipEnd: false },
    ]);
    expect(monthSegments({ startDate: "2026-12-01", endDate: "2026-12-02" }, grid)).toEqual([]);
  });
});

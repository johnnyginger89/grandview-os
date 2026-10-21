import { describe, expect, it } from "vitest";
import { windowQuerySchema, windowRangeSchema } from "./schemas";
import { defaultScheduleSettings } from "./settings-schema";
import { resolveWindow, shiftWindow } from "./window";

const settings = defaultScheduleSettings();
const q = (params: Record<string, unknown>) => windowQuerySchema.parse(params);

describe("resolveWindow", () => {
  it("defaults to two weeks from this week's Monday", () => {
    const w = resolveWindow(q({}), settings, "2026-10-21");
    expect(w).toMatchObject({ view: "timeline", from: "2026-10-19", to: "2026-11-01", days: 14, span: 14, month: null, crews: [] });
    expect(shiftWindow(w, 1)).toBe("2026-11-02");
    expect(shiftWindow(w, -1)).toBe("2026-10-05");
  });

  it("snaps a mid-week `from` to the week start and honours the span", () => {
    expect(resolveWindow(q({ from: "2026-10-08", span: "28" }), settings, "2026-10-21")).toMatchObject({ from: "2026-10-05", to: "2026-11-01", days: 28 });
    expect(resolveWindow(q({ from: "2026-10-08" }), { ...settings, weekStartsOn: 0 }, "2026-10-21").from).toBe("2026-10-04");
  });

  it("shows the whole month grid in month view, within the window limit", () => {
    const w = resolveWindow(q({ view: "month", from: "2026-10-21" }), settings, "2026-01-01");
    expect(w).toMatchObject({ view: "month", from: "2026-09-28", to: "2026-11-08", days: 42, month: "2026-10-01" });
    expect(windowRangeSchema.safeParse({ from: w.from, to: w.to }).success).toBe(true);
    expect(shiftWindow(w, 1)).toBe("2026-11-01");
    expect(shiftWindow({ ...w, month: "2026-01-01" }, -1)).toBe("2025-12-01");
    expect(shiftWindow({ ...w, month: "2026-12-01" }, 1)).toBe("2027-01-01");
  });
});

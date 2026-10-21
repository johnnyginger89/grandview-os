import { describe, expect, it } from "vitest";
import { defaultScheduleSettings } from "@/lib/schedule/settings-schema";
import { calendarsFor } from "@/lib/schedule/working-days";
import { dayList, previewRangeText, resolveRange, warningsSummary, warningText } from "./schedule-text";

const cal = calendarsFor(defaultScheduleSettings(), "2026-09-01", "2026-12-31").calFor(null);

describe("warning text", () => {
  it("writes every warning in plain words", () => {
    expect(warningText({ type: "double_booked", crewName: "Niko", dates: ["2026-10-27"], otherProjectNumbers: [3015] })).toBe(
      "Double-booked: Niko also has #3015 on Tue, Oct 27.",
    );
    expect(warningText({ type: "non_working", days: [{ date: "2026-10-12", label: "Thanksgiving Day" }] })).toContain("Thanksgiving Day");
    expect(warningText({ type: "customer_told", communicatedStart: "2026-10-26", newStart: "2026-10-28" })).toContain("Customer was told Mon, Oct 26 · now Wed, Oct 28");
  });

  it("summarises warnings for a toast, leaving out days off", () => {
    expect(warningsSummary([{ type: "not_ready", missing: ["Colours & paint", "Deposit received"] }, { type: "non_working", days: [] }])).toBe(
      "Heads up: Not ready yet: Colours & paint, Deposit received.",
    );
    expect(warningsSummary([{ type: "non_working", days: [] }])).toBe("");
  });

  it("lists days", () => {
    expect(dayList(["2026-10-26"])).toBe("Mon, Oct 26");
    expect(dayList(["2026-10-26", "2026-10-27"])).toBe("Mon, Oct 26 and Tue, Oct 27");
    expect(dayList(["2026-10-26", "2026-10-27", "2026-10-28"])).toBe("Mon, Oct 26, Tue, Oct 27 and 1 more day");
    expect(previewRangeText("2026-10-26", "2026-10-27", 2)).toBe("Mon, Oct 26 → Tue, Oct 27 · 2 work days");
  });
});

describe("resolveRange", () => {
  it("computes the end from working days, snapping a weekend start", () => {
    expect(resolveRange({ start: "2026-10-24", end: "", days: "2", mode: "days" }, cal)).toEqual({
      ok: true,
      startDate: "2026-10-26",
      endDate: "2026-10-27",
      workingDays: 2,
      snappedFrom: "2026-10-24",
    });
    // Skips Thanksgiving (Mon Oct 12).
    expect(resolveRange({ start: "2026-10-08", end: "", days: "3", mode: "days" }, cal)).toMatchObject({ endDate: "2026-10-13" });
  });

  it("counts working days for an explicit end and keeps the start as typed", () => {
    expect(resolveRange({ start: "2026-10-24", end: "2026-10-27", days: "", mode: "end" }, cal)).toEqual({
      ok: true,
      startDate: "2026-10-24",
      endDate: "2026-10-27",
      workingDays: 2,
      snappedFrom: null,
    });
  });

  it("explains bad input", () => {
    expect(resolveRange({ start: "", end: "", days: "2", mode: "days" }, cal)).toEqual({ ok: false, error: "Pick a start date." });
    expect(resolveRange({ start: "2026-10-26", end: "2026-10-20", days: "", mode: "end" }, cal)).toMatchObject({ ok: false });
    expect(resolveRange({ start: "2026-10-26", end: "", days: "0", mode: "days" }, cal)).toMatchObject({ ok: false });
    expect(resolveRange({ start: "2026-01-01", end: "2026-12-01", days: "", mode: "end" }, cal)).toMatchObject({ ok: false });
  });
});

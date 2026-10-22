import { describe, expect, it } from "vitest";
import { linkedReadinessChanges, readinessItems, readinessSummary, shownState } from "./readiness";
import { DEFAULT_READINESS_CHECKS } from "./settings-schema";

const checks = DEFAULT_READINESS_CHECKS;
const [pressureWash, , colourConsult] = checks;

describe("readiness", () => {
  it("treats missing rows as todo", () => {
    expect(readinessSummary(checks, [])).toEqual({ total: 4, ready: 0, pct: 0, missing: ["Pressure washing", "Colours & paint", "Colour consult", "Deposit received"] });
  });

  it("counts done and not needed as ready", () => {
    const s = readinessSummary(checks, [
      { checkKey: "pressure_wash", state: "not_needed" },
      { checkKey: "paint", state: "in_progress" },
      { checkKey: "deposit", state: "done" },
    ]);
    expect(s).toEqual({ total: 4, ready: 2, pct: 50, missing: ["Colours & paint", "Colour consult"] });
  });

  it("ignores answers to removed checks", () => {
    const s = readinessSummary(checks.slice(0, 1), [{ checkKey: "deposit", state: "todo" }, { checkKey: "pressure_wash", state: "done" }]);
    expect(s).toEqual({ total: 1, ready: 1, pct: 100, missing: [] });
    expect(readinessSummary([], []).pct).toBe(100);
  });

  it("merges checks with answers for the checklist", () => {
    const items = readinessItems(checks, [{ checkKey: "paint", state: "in_progress", dueDate: "2026-10-23", note: "[TEST DATA] SW order" }]);
    expect(items.map((i) => [i.key, i.state, i.stateLabel])).toEqual([
      ["pressure_wash", "todo", "To book"],
      ["paint", "in_progress", "Ordered"],
      ["colour_consult", "todo", "Needed"],
      ["deposit", "todo", "Not yet"],
    ]);
    expect(items[1]).toMatchObject({ dueDate: "2026-10-23", note: "[TEST DATA] SW order" });
  });

});

describe("checks linked to bookings follow the calendar", () => {
  const row = (checkKey: string, state: "todo" | "in_progress" | "done" | "not_needed", dueDate: string | null = null) => ({ checkKey, state, dueDate });

  it("a booking makes its check booked, with the booking's date", () => {
    expect(linkedReadinessChanges(checks, [], [{ kind: "pressure_wash", startDate: "2026-10-22" }], ["pressure_wash"])).toEqual([
      { checkKey: "pressure_wash", state: "in_progress", dueDate: "2026-10-22", before: { state: "todo", dueDate: null } },
    ]);
    // An office "todo" date is replaced by the booking's.
    expect(linkedReadinessChanges(checks, [row("colour_consult", "todo", "2026-10-01")], [{ kind: "colour_consult", startDate: "2026-10-27" }], ["colour_consult"])).toEqual([
      { checkKey: "colour_consult", state: "in_progress", dueDate: "2026-10-27", before: { state: "todo", dueDate: "2026-10-01" } },
    ]);
  });

  it("a moved booking moves the date, and with several the latest one counts", () => {
    const moved = linkedReadinessChanges(checks, [row("pressure_wash", "in_progress", "2026-10-22")], [{ kind: "pressure_wash", startDate: "2026-10-29" }], ["pressure_wash"]);
    expect(moved).toEqual([{ checkKey: "pressure_wash", state: "in_progress", dueDate: "2026-10-29", before: { state: "in_progress", dueDate: "2026-10-22" } }]);
    const two = [{ kind: "pressure_wash" as const, startDate: "2026-11-05" }, { kind: "pressure_wash" as const, startDate: "2026-10-20" }];
    expect(linkedReadinessChanges(checks, [], two, ["pressure_wash"])[0]).toMatchObject({ state: "in_progress", dueDate: "2026-11-05" });
    // Nothing to write when it already says so.
    expect(linkedReadinessChanges(checks, [row("pressure_wash", "in_progress", "2026-11-05")], two, ["pressure_wash"])).toEqual([]);
  });

  it("removing the last booking puts the check back to the start", () => {
    expect(linkedReadinessChanges(checks, [row("pressure_wash", "in_progress", "2026-10-22")], [], ["pressure_wash"])).toEqual([
      { checkKey: "pressure_wash", state: "todo", dueDate: null, before: { state: "in_progress", dueDate: "2026-10-22" } },
    ]);
    expect(linkedReadinessChanges(checks, [row("pressure_wash", "todo", "2026-10-30")], [], ["pressure_wash"])).toEqual([]);
  });

  it("leaves the office's done and not needed alone, and only touches the kinds that changed", () => {
    const booked = [{ kind: "pressure_wash" as const, startDate: "2026-10-22" }, { kind: "colour_consult" as const, startDate: "2026-10-23" }];
    expect(linkedReadinessChanges(checks, [row("pressure_wash", "done"), row("colour_consult", "not_needed")], [], ["pressure_wash", "colour_consult"])).toEqual([]);
    expect(linkedReadinessChanges(checks, [row("pressure_wash", "done")], booked, ["pressure_wash"])).toEqual([]);
    expect(linkedReadinessChanges(checks, [], booked, ["work"])).toEqual([]);
    expect(linkedReadinessChanges(checks, [], booked, ["colour_consult"]).map((c) => c.checkKey)).toEqual(["colour_consult"]);
  });

  it("shows a booked pressure wash as done once its last booked day has passed", () => {
    const on = (today: string, last?: string) => ({ today, bookedThrough: last ? { pressure_wash: last } : {} });
    expect(shownState(pressureWash, "in_progress", on("2026-10-22", "2026-10-22"))).toBe("in_progress");
    expect(shownState(pressureWash, "in_progress", on("2026-10-23", "2026-10-22"))).toBe("done");
    // A pressure wash booked again for later isn't done yet; nor is one with nothing on the calendar.
    expect(shownState(pressureWash, "in_progress", on("2026-10-23", "2026-10-29"))).toBe("in_progress");
    expect(shownState(pressureWash, "in_progress", on("2026-10-23"))).toBe("in_progress");
    // Only "booked" turns into done, and only for a pressure wash.
    expect(shownState(pressureWash, "todo", on("2026-10-23", "2026-10-22"))).toBe("todo");
    expect(shownState(colourConsult, "in_progress", { today: "2026-10-23", bookedThrough: { colour_consult: "2026-10-22" } })).toBe("in_progress");
    expect(shownState(pressureWash, "in_progress")).toBe("in_progress");
  });

  it("counts a past pressure wash as ready on the checklist and in the summary", () => {
    const ctx = { today: "2026-10-23", bookedThrough: { pressure_wash: "2026-10-22" } };
    const rows = [{ checkKey: "pressure_wash", state: "in_progress" as const, dueDate: "2026-10-22", note: null }];
    expect(readinessItems(checks, rows, ctx)[0]).toMatchObject({ key: "pressure_wash", state: "done", stateLabel: "Done", dueDate: "2026-10-22" });
    expect(readinessSummary(checks, rows, ctx).missing).not.toContain("Pressure washing");
    expect(readinessItems(checks, rows)[0]).toMatchObject({ state: "in_progress", stateLabel: "Booked" });
  });
});

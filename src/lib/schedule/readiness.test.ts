import { describe, expect, it } from "vitest";
import { linkedReadinessUpdate, readinessItems, readinessSummary } from "./readiness";
import { DEFAULT_READINESS_CHECKS } from "./settings-schema";

const checks = DEFAULT_READINESS_CHECKS;

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

  it("books a linked check only from todo", () => {
    expect(linkedReadinessUpdate(checks, [], "pressure_wash", "2026-10-22")).toEqual({ checkKey: "pressure_wash", state: "in_progress", dueDate: "2026-10-22" });
    expect(linkedReadinessUpdate(checks, [{ checkKey: "pressure_wash", state: "done" }], "pressure_wash", "2026-10-22")).toBeNull();
    expect(linkedReadinessUpdate(checks, [], "work", "2026-10-22")).toBeNull();
  });
});

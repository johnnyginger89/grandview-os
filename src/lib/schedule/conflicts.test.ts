import { describe, expect, it } from "vitest";
import { assignLanes, conflictsForEntry, findCrewConflicts, findPersonConflicts, laneCount, type EntryLike } from "./conflicts";
import { closedDaysBetween } from "./holidays";
import { defaultScheduleSettings } from "./settings-schema";
import { crewCalendar } from "./working-days";

const settings = defaultScheduleSettings();
const cal = crewCalendar(settings, null, closedDaysBetween("2026-01-01", "2026-12-31", settings));
const calFor = () => cal;

const e = (id: string, crewId: string | null, startDate: string, endDate: string, kind: EntryLike["kind"] = "work"): EntryLike => ({
  id, crewId, startDate, endDate, projectId: `p-${id}`, kind,
});

describe("crew conflicts", () => {
  it("flags the same crew on the same working day", () => {
    const c = findCrewConflicts([e("a", "niko", "2026-10-26", "2026-10-28"), e("b", "niko", "2026-10-28", "2026-10-30", "pressure_wash")], calFor);
    expect(c).toEqual([{ crewId: "niko", date: "2026-10-28", entryIds: ["a", "b"] }]);
  });

  it("ignores overlaps on a weekend, different crews and the Unassigned row", () => {
    expect(findCrewConflicts([e("a", "niko", "2026-10-23", "2026-10-24"), e("b", "niko", "2026-10-24", "2026-10-25")], calFor)).toEqual([]);
    expect(findCrewConflicts([e("a", "niko", "2026-10-26", "2026-10-28"), e("b", "tia", "2026-10-26", "2026-10-28")], calFor)).toEqual([]);
    expect(findCrewConflicts([e("a", null, "2026-10-26", "2026-10-28"), e("b", null, "2026-10-26", "2026-10-28")], calFor)).toEqual([]);
  });

  it("reports one booking's conflicts", () => {
    const me = e("a", "niko", "2026-10-26", "2026-10-30");
    const r = conflictsForEntry(me, [me, e("b", "niko", "2026-10-29", "2026-11-03"), e("c", "tia", "2026-10-26", "2026-10-30"), e("d", "niko", "2026-10-31", "2026-11-01")], cal);
    expect(r).toEqual({ dates: ["2026-10-29", "2026-10-30"], otherEntryIds: ["b"] });
    expect(conflictsForEntry(e("x", null, "2026-10-26", "2026-10-30"), [e("y", null, "2026-10-26", "2026-10-30")], cal)).toEqual({ dates: [], otherEntryIds: [] });
  });
});

describe("person conflicts", () => {
  it("flags someone in two crews booked on the same day", () => {
    const members = new Map([["niko", ["u1", "u2"]], ["pw", ["u1"]]]);
    const r = findPersonConflicts([e("a", "niko", "2026-10-26", "2026-10-27"), e("b", "pw", "2026-10-27", "2026-10-27")], members, calFor);
    expect(r).toEqual([{ userId: "u1", date: "2026-10-27", crewIds: ["niko", "pw"] }]);
  });
});

describe("assignLanes", () => {
  it("stacks overlapping bars per crew row", () => {
    const lanes = assignLanes([e("A", "niko", "2026-10-01", "2026-10-03"), e("B", "niko", "2026-10-02", "2026-10-04"), e("C", "niko", "2026-10-04", "2026-10-05"), e("D", "tia", "2026-10-01", "2026-10-05")]);
    expect([lanes.get("A"), lanes.get("B"), lanes.get("C"), lanes.get("D")]).toEqual([0, 1, 0, 0]);
    expect(laneCount(lanes, ["A", "B", "C"])).toBe(2);
    expect(laneCount(lanes, [])).toBe(1);
  });
});

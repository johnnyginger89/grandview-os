import { describe, expect, it } from "vitest";
import { monthGrid } from "@/lib/schedule/dates";
import { defaultScheduleSettings } from "@/lib/schedule/settings-schema";
import type { CrewDTO, EntryDTO, UnscheduledJobDTO } from "@/lib/schedule/types";
import {
  agendaDays,
  applyEntryOp,
  boardCalendars,
  bookedDays,
  crewRows,
  draftEntry,
  filterEntries,
  jobTypeTag,
  keyboardStep,
  matchesSearch,
  monthLayout,
  planDrop,
  windowConflicts,
  type PlanContext,
} from "./board-model";

const settings = defaultScheduleSettings();
const { calFor, closed } = boardCalendars(settings, "2026-10-05", "2026-11-01");

const crew = (id: string, over: Partial<CrewDTO> = {}): CrewDTO => ({
  id,
  name: `[TEST DATA] ${id}`,
  kind: "in_house",
  trade: "painting",
  subCompany: null,
  color: "sky",
  crewSize: 3,
  hoursPerDay: "8",
  worksSaturdays: false,
  active: true,
  sortOrder: 0,
  memberCount: 0,
  ...over,
});

const entry = (id: string, over: Partial<EntryDTO> = {}): EntryDTO => ({
  ...draftEntry(id, { projectId: `p-${id}`, number: 3000 + Number(id.replace(/\D/g, "") || 0), jobTitle: "Exterior repaint", jobType: "exterior", customerName: "[TEST DATA] Kim", city: "Surrey", status: "scheduled" }, {
    crewId: "niko",
    crewName: "Niko",
    kind: "work",
    startDate: "2026-10-26",
    endDate: "2026-10-30",
  }),
  version: 1,
  ...over,
});

const job: UnscheduledJobDTO = {
  projectId: "p-job",
  number: 3018,
  jobTitle: "Exterior repaint",
  customerName: "[TEST DATA] Lee",
  city: "White Rock",
  jobType: "exterior",
  soldAt: "2026-10-03T19:00:00.000Z",
  status: "need_to_schedule",
  estimatedHours: "42.00",
  scheduledHours: "0.00",
  remainingHours: "42.00",
  notBefore: null,
  readiness: { total: 4, ready: 2, missing: ["Colours & paint", "Deposit received"] },
  group: "need_to_schedule",
};

const crews = [crew("niko", { sortOrder: 1 }), crew("tia", { sortOrder: 0, crewSize: 2 }), crew("sat", { sortOrder: 2, worksSaturdays: true }), crew("old", { sortOrder: 3, active: false })];
const crewsById = new Map(crews.map((c) => [c.id, c]));
const ctx = (entries: EntryDTO[] = []): PlanContext => ({ crewsById, calFor, entries, fallback: { crewSize: 3, hoursPerDay: "8" }, monthCrewId: null });

describe("crew rows", () => {
  it("orders crews by sort order, applies the filter and ends with Unassigned", () => {
    expect(crewRows(crews, []).map((r) => r.key)).toEqual(["tia", "niko", "sat", "old", "unassigned"]);
    expect(crewRows(crews, ["niko"]).map((r) => r.key)).toEqual(["niko", "unassigned"]);
    expect(crewRows(crews, []).find((r) => r.key === "old")?.droppable).toBe(false);
  });

  it("keeps unassigned bookings when filtering", () => {
    const list = [entry("1"), entry("2", { crewId: null }), entry("3", { crewId: "tia" })];
    expect(filterEntries(list, ["niko"]).map((e) => e.id)).toEqual(["1", "2"]);
  });
});

describe("planDrop", () => {
  it("drops a sidebar job with the crew's suggested length, snapping off the weekend", () => {
    // 42 h with 3 × 8 h = 2 working days; Sat Oct 24 snaps to Mon Oct 26.
    expect(planDrop({ kind: "job", job }, { date: "2026-10-24", crewId: "niko" }, null, ctx())).toMatchObject({
      startDate: "2026-10-26",
      endDate: "2026-10-27",
      crewId: "niko",
      workingDays: 2,
      valid: true,
      conflict: false,
    });
    // Tia has 2 people: 42 / 16 = 2.6 → 3 days.
    expect(planDrop({ kind: "job", job }, { date: "2026-10-26", crewId: "tia" }, null, ctx()).endDate).toBe("2026-10-28");
  });

  it("flags double-booking and inactive crews", () => {
    const busy = [entry("1", { startDate: "2026-10-27", endDate: "2026-10-27" })];
    expect(planDrop({ kind: "job", job }, { date: "2026-10-26", crewId: "niko" }, null, ctx(busy)).conflict).toBe(true);
    expect(planDrop({ kind: "job", job }, { date: "2026-10-26", crewId: "tia" }, null, ctx(busy)).conflict).toBe(false);
    expect(planDrop({ kind: "job", job }, { date: "2026-10-26", crewId: "old" }, null, ctx()).valid).toBe(false);
  });

  it("moves a booking keeping its working days, and reassigns the crew", () => {
    const e = entry("1");
    const moved = planDrop({ kind: "entry", entry: e, mode: "move" }, { date: "2026-10-28", crewId: "tia" }, "2026-10-27", ctx([e]));
    expect(moved).toMatchObject({ startDate: "2026-10-27", endDate: "2026-11-02", crewId: "tia", workingDays: 5, conflict: false, changed: true });
    const same = planDrop({ kind: "entry", entry: e, mode: "move" }, { date: "2026-10-27", crewId: "niko" }, "2026-10-27", ctx([e]));
    expect(same.changed).toBe(false);
  });

  it("keeps the crew in the month view and resizes from either edge", () => {
    const e = entry("1");
    expect(planDrop({ kind: "entry", entry: e, mode: "move" }, { date: "2026-10-27", crewId: undefined }, "2026-10-26", ctx()).crewId).toBe("niko");
    expect(planDrop({ kind: "entry", entry: e, mode: "resize-end" }, { date: "2026-11-02", crewId: "niko" }, "2026-10-30", ctx())).toMatchObject({ startDate: "2026-10-26", endDate: "2026-11-02" });
    expect(planDrop({ kind: "entry", entry: e, mode: "resize-start" }, { date: "2026-11-05", crewId: "niko" }, "2026-10-26", ctx())).toMatchObject({ startDate: "2026-10-30", endDate: "2026-10-30" });
  });
});

describe("keyboardStep", () => {
  const rows = crewRows(crews, []);
  const k = { rows, crewsById, calFor };
  const cur = { startDate: "2026-10-26", endDate: "2026-10-30", crewId: "niko" as string | null };

  it("moves by working days and keeps the length", () => {
    expect(keyboardStep(cur, "right", { shift: false, alt: false }, k)).toEqual({ startDate: "2026-10-27", endDate: "2026-11-02", crewId: "niko" });
    // Back from Monday Oct 26 goes to Friday Oct 23.
    expect(keyboardStep(cur, "left", { shift: false, alt: false }, k)).toEqual({ startDate: "2026-10-23", endDate: "2026-10-29", crewId: "niko" });
  });

  it("resizes with Shift (end) and Alt (start)", () => {
    expect(keyboardStep(cur, "right", { shift: true, alt: false }, k)).toMatchObject({ startDate: "2026-10-26", endDate: "2026-10-31" });
    expect(keyboardStep(cur, "right", { shift: false, alt: true }, k)).toMatchObject({ startDate: "2026-10-27", endDate: "2026-10-30" });
  });

  it("changes crew rows, skipping inactive crews", () => {
    expect(keyboardStep(cur, "up", { shift: false, alt: false }, k).crewId).toBe("tia");
    const onSat = { ...cur, crewId: "sat" };
    expect(keyboardStep(onSat, "down", { shift: false, alt: false }, k).crewId).toBe(null);
  });
});

describe("views", () => {
  it("lists working days in the agenda with Day x of n, and stat holidays", () => {
    const e = entry("1", { startDate: "2026-10-08", endDate: "2026-10-14" });
    const days = agendaDays([e], "2026-10-08", "2026-10-14", closed, () => calFor(null));
    expect(days.map((d) => d.date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(days.find((d) => d.date === "2026-10-12")).toMatchObject({ items: [], closed: { label: "Thanksgiving Day" } });
    expect(days.find((d) => d.date === "2026-10-13")?.items[0]).toMatchObject({ dayNumber: 3, totalDays: 4 });
  });

  it("stacks month bars into four lanes and counts the rest", () => {
    const grid = monthGrid(2026, 10, 1);
    const many = Array.from({ length: 6 }, (_, i) => entry(String(i + 1), { startDate: "2026-10-26", endDate: "2026-10-27" }));
    const week = monthLayout(many, grid).find((w) => w.days[0] === "2026-10-26")!;
    expect(week.segments).toHaveLength(4);
    expect(week.hidden.slice(0, 3)).toEqual([2, 2, 0]);
    // A booking over a week boundary is split, with continuation flags.
    const long = monthLayout([entry("9", { startDate: "2026-10-29", endDate: "2026-11-03" })], grid);
    expect(long.flatMap((w) => w.segments.map((s) => [s.col, s.span, s.clipStart, s.clipEnd]))).toEqual([
      [3, 4, false, true],
      [0, 2, true, false],
    ]);
  });

  it("marks double-booked bars with the other job numbers", () => {
    const a = entry("1");
    const b = entry("2", { startDate: "2026-10-30", endDate: "2026-11-03" });
    const c = entry("3", { crewId: "tia" });
    const m = windowConflicts([a, b, c], crewsById, calFor);
    expect(m.get("1")).toEqual({ dates: ["2026-10-30"], otherNumbers: [3002] });
    expect(m.has("3")).toBe(false);
  });

  it("counts booked working days per crew", () => {
    const list = [entry("1"), entry("2", { startDate: "2026-10-29", endDate: "2026-11-02" })];
    expect(bookedDays(list, "niko", "2026-10-26", "2026-11-01", calFor(null))).toBe(5);
  });

  it("searches by number, name and city", () => {
    const x = { number: 3018, customerName: "[TEST DATA] Kim", city: "White Rock", jobTitle: "Exterior repaint" };
    expect(matchesSearch("#301", x)).toBe(true);
    expect(matchesSearch("3019", x)).toBe(false);
    expect(matchesSearch("white", x)).toBe(true);
    expect(matchesSearch("kim", x)).toBe(true);
    expect(matchesSearch("  ", x)).toBe(true);
  });

  it("labels job types", () => {
    expect(jobTypeTag("exterior")).toBe("Ext");
    expect(jobTypeTag("interior")).toBe("Int");
    expect(jobTypeTag(null)).toBe(null);
  });
});

describe("applyEntryOp", () => {
  it("updates, adds and removes bars", () => {
    const list = [entry("1"), entry("2")];
    expect(applyEntryOp(list, { type: "update", id: "1", patch: { startDate: "2026-10-27" } })[0].startDate).toBe("2026-10-27");
    expect(applyEntryOp(list, { type: "create", entry: entry("3") })).toHaveLength(3);
    expect(applyEntryOp(list, { type: "delete", id: "2" }).map((e) => e.id)).toEqual(["1"]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb, statusChanges: [] as unknown[][], hooks: [] as unknown[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async () => {} }));
vi.mock("./schedule-hooks", () => ({ afterScheduleChange: async (c: unknown) => void h.hooks.push(c) }));
vi.mock("./project-status", () => ({
  changeProjectStatus: async (...args: unknown[]) => {
    h.statusChanges.push(args);
    return { changed: true };
  },
}));
vi.mock("./schedule-settings", async () => {
  const { defaultScheduleSettings } = await import("@/lib/schedule/settings-schema");
  return {
    getScheduleSettings: async () => defaultScheduleSettings(),
    getHoursPerCrewDay: async () => "8",
    defaultCapacity: (s: { defaultCrewSize: number }, hours: string) => ({ crewSize: s.defaultCrewSize, hoursPerDay: hours }),
  };
});

const { createEntry, deleteEntry, removeProjectEntries, splitEntry, updateEntry, ScheduleError } = await import("./schedule");
const { safeErrorMessage } = await import("@/lib/action-error");
const { planSplit } = await import("@/lib/schedule/split");
const { calendarsFor } = await import("@/lib/schedule/working-days");
const { defaultScheduleSettings } = await import("@/lib/schedule/settings-schema");

const P = "00000000-0000-4000-8000-000000000001";
const E = "00000000-0000-4000-8000-000000000002";
const E2 = "00000000-0000-4000-8000-000000000003";
const ACTOR = { id: "user-pm" };

const project = (status: string, extra: object = {}) => ({ id: P, number: 3018, status, estimatedHours: "42.0000", customerId: "cust-1", opportunityId: null, ...extra });
const entryRow = (extra: object = {}) => ({
  id: E, version: 1, projectId: P, projectNumber: 3018, projectName: "[TEST DATA] Kim – Exterior repaint", estimateTitle: "Exterior repaint", jobType: "exterior",
  customerName: "[TEST DATA] Kim", city: "Surrey", projectStatus: "scheduled", confirmation: null, communicatedStart: null, crewId: null, crewName: null,
  kind: "work", phaseLabel: null, startDate: "2026-10-26", endDate: "2026-10-30", plannedHours: null, notes: null, crewNotes: null,
  updatedAt: new Date("2026-10-21T19:00:00Z"), deletedAt: null, ...extra,
});
const rawEntry = (extra: object = {}) => ({
  id: E, projectId: P, crewId: null, kind: "work", phaseLabel: null, startDate: "2026-10-26", endDate: "2026-10-30", plannedHours: null, notes: null, crewNotes: null,
  version: 1, createdBy: null, createdAt: new Date(), updatedBy: null, updatedAt: new Date(), deletedAt: null, deletedBy: null, ...extra,
});

beforeEach(() => {
  h.fake.reset();
  h.statusChanges = [];
  h.hooks = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T19:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createEntry", () => {
  it("refuses a cancelled project with an exposed message and writes nothing", async () => {
    h.fake.queue({ "select:projects": [[project("cancelled")]] });
    const p = createEntry({ projectId: P, crewId: null, startDate: "2026-10-26" }, ACTOR);
    await expect(p).rejects.toBeInstanceOf(ScheduleError);
    await expect(p).rejects.toThrow("This job is cancelled.");
    expect(h.fake.find("insert", "schedule_entries")).toEqual([]);
    expect(h.hooks).toEqual([]);
  });

  it("asks before scheduling an on-hold job", async () => {
    h.fake.queue({ "select:projects": [[project("on_hold")]] });
    const err = await createEntry({ projectId: P, crewId: null, startDate: "2026-10-26" }, ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(ScheduleError);
    expect(err.reason).toBe("confirm_on_hold");
    expect(safeErrorMessage(err)).toBe("This job is on hold. Confirm to schedule it.");
  });

  it("books the suggested days from a Saturday drop and moves the job to Scheduled in the same transaction", async () => {
    h.fake.queue({
      "select:projects": [[project("on_hold")]],
      "select:schedule_entries": [[], [{ first: "2026-10-26", last: "2026-10-27", n: 1 }], [entryRow({ endDate: "2026-10-27" })]],
      "insert:schedule_entries": [[{ id: E }]],
    });
    const r = await createEntry({ projectId: P, crewId: null, startDate: "2026-10-24", confirmOnHold: true }, ACTOR);
    const insert = h.fake.find("insert", "schedule_entries")[0];
    // 42 h with the default 3 × 8 h crew = 2 working days, snapped from Saturday to Monday.
    expect(insert.args.values[0]).toMatchObject({ projectId: P, crewId: null, kind: "work", startDate: "2026-10-26", endDate: "2026-10-27", createdBy: "user-pm" });
    const projectUpdate = h.fake.find("update", "projects")[0];
    expect(projectUpdate.args.set[0]).toMatchObject({ startDate: new Date("2026-10-26T07:00:00Z"), endDate: new Date("2026-10-27T07:00:00Z") });
    expect(h.statusChanges).toHaveLength(1);
    expect(h.statusChanges[0].slice(0, 3)).toEqual([P, "scheduled", { actorId: "user-pm", note: "Scheduled on the calendar" }]);
    expect(h.statusChanges[0][3]).toBe(h.fake.db);
    expect(h.fake.find("insert", "activities")[0].args.values[0]).toMatchObject({ type: "system", body: "Scheduled (no crew yet): Mon, Oct 26 – Tue, Oct 27" });
    expect(r.entry).toMatchObject({ id: E, jobTitle: "Exterior repaint", confirmation: "none", startDate: "2026-10-26", endDate: "2026-10-27" });
    expect(h.hooks).toEqual([{ kind: "create", projectId: P, entryIds: [E], actorId: "user-pm" }]);
  });

  it("refuses a work booking on a finished job", async () => {
    h.fake.queue({ "select:projects": [[project("complete")]] });
    await expect(createEntry({ projectId: P, crewId: null, startDate: "2026-10-26" }, ACTOR)).rejects.toThrow(/touch-up/);
  });
});

describe("updateEntry", () => {
  it("refuses a stale version with the refresh message", async () => {
    h.fake.queue({ "select:schedule_entries": [[rawEntry({ version: 3 })]] });
    const err = await updateEntry({ id: E, version: 2, startDate: "2026-10-27", endDate: "2026-10-31" }, ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(ScheduleError);
    expect(err.reason).toBe("stale");
    expect(safeErrorMessage(err)).toBe("Someone else changed this booking just now – the calendar has been refreshed.");
    expect(h.fake.find("update", "schedule_entries")).toEqual([]);
  });

  it("refuses when another save wins the race between the read and the write", async () => {
    h.fake.queue({ "select:schedule_entries": [[rawEntry({ version: 2 })]], "select:projects": [[project("scheduled")]], "update:schedule_entries": [[]] });
    await expect(updateEntry({ id: E, version: 2, crewNotes: "Gate code at the office" }, ACTOR)).rejects.toThrow(/Someone else changed this booking/);
  });

  it("moves a booking, bumps the version and keeps the project dates in step", async () => {
    h.fake.queue({
      "select:schedule_entries": [[rawEntry({ version: 2 })], [{ first: "2026-10-27", last: "2026-11-02", n: 1 }], [entryRow({ version: 3, startDate: "2026-10-27", endDate: "2026-11-02" })]],
      "select:projects": [[project("scheduled")]],
      "update:schedule_entries": [[{ id: E }]],
    });
    const r = await updateEntry({ id: E, version: 2, startDate: "2026-10-27", endDate: "2026-11-02" }, ACTOR);
    const set = h.fake.find("update", "schedule_entries")[0].args.set[0] as Record<string, unknown>;
    expect(set).toMatchObject({ startDate: "2026-10-27", endDate: "2026-11-02", updatedBy: "user-pm" });
    expect(h.fake.find("update", "projects")).toHaveLength(1);
    expect(h.statusChanges).toEqual([]);
    expect(r.entry.version).toBe(3);
    expect(h.hooks).toHaveLength(1);
  });
});

describe("deleteEntry", () => {
  it("moves the job back to Need to schedule when its last work booking goes", async () => {
    h.fake.queue({
      "select:schedule_entries": [[rawEntry()], [{ first: null, last: null, n: 0 }]],
      "select:projects": [[project("scheduled")]],
      "update:schedule_entries": [[{ id: E }]],
    });
    expect(await deleteEntry({ id: E, version: 1 }, ACTOR)).toEqual({ projectId: P });
    expect(h.fake.find("update", "schedule_entries")[0].args.set[0]).toMatchObject({ deletedBy: "user-pm" });
    expect(h.fake.find("update", "projects")[0].args.set[0]).toMatchObject({ startDate: null, endDate: null });
    expect(h.statusChanges[0].slice(0, 3)).toEqual([P, "need_to_schedule", { actorId: "user-pm", note: "Removed from the calendar" }]);
    expect(h.fake.find("insert", "activities")[0].args.values[0]).toMatchObject({ body: "Removed from the schedule: no crew, Mon, Oct 26 – Fri, Oct 30" });
  });
});

describe("readiness checks tied to bookings follow every change", () => {
  const PW = { kind: "pressure_wash", startDate: "2026-10-27", endDate: "2026-10-27" };
  const AGG = { first: null, last: null, n: 0 };
  const booked = (dueDate: string, state = "in_progress") => [{ projectId: P, checkKey: "pressure_wash", state, dueDate }];
  const readinessWrites = () =>
    h.fake.find("insert", "project_readiness").map((c) => {
      const v = c.args.values[0] as Record<string, unknown>;
      return { checkKey: v.checkKey, state: v.state, dueDate: v.dueDate };
    });

  it("booking a pressure wash marks it booked for that day", async () => {
    h.fake.queue({
      "select:projects": [[project("need_to_schedule")]],
      "insert:schedule_entries": [[{ id: E }]],
      "select:schedule_entries": [[{ kind: "pressure_wash", startDate: "2026-10-27" }], [AGG], [entryRow(PW)]],
    });
    await createEntry({ projectId: P, crewId: null, ...PW }, ACTOR);
    expect(readinessWrites()).toEqual([{ checkKey: "pressure_wash", state: "in_progress", dueDate: "2026-10-27" }]);
  });

  it("moving it moves the date", async () => {
    h.fake.queue({
      "select:schedule_entries": [[rawEntry(PW)], [AGG], [{ kind: "pressure_wash", startDate: "2026-10-29" }], [entryRow({ ...PW, version: 2, startDate: "2026-10-29", endDate: "2026-10-29" })]],
      "select:projects": [[project("need_to_schedule")]],
      "update:schedule_entries": [[{ id: E }]],
      "select:project_readiness": [booked("2026-10-27")],
    });
    await updateEntry({ id: E, version: 1, startDate: "2026-10-29", endDate: "2026-10-29" }, ACTOR);
    expect(readinessWrites()).toEqual([{ checkKey: "pressure_wash", state: "in_progress", dueDate: "2026-10-29" }]);
  });

  it("removing the last one, or turning it into painting, puts the check back to the start", async () => {
    h.fake.queue({
      "select:schedule_entries": [[rawEntry(PW)], [AGG], []],
      "select:projects": [[project("need_to_schedule")]],
      "update:schedule_entries": [[{ id: E }]],
      "select:project_readiness": [booked("2026-10-27")],
    });
    await deleteEntry({ id: E, version: 1 }, ACTOR);
    expect(readinessWrites()).toEqual([{ checkKey: "pressure_wash", state: "todo", dueDate: null }]);

    h.fake.reset();
    h.fake.queue({
      "select:schedule_entries": [[rawEntry(PW)], [{ first: "2026-10-27", last: "2026-10-27", n: 1 }], [], [entryRow({ ...PW, kind: "work", version: 2 })]],
      "select:projects": [[project("need_to_schedule")]],
      "update:schedule_entries": [[{ id: E }]],
      "select:project_readiness": [booked("2026-10-27")],
    });
    await updateEntry({ id: E, version: 1, kind: "work" }, ACTOR);
    expect(readinessWrites()).toEqual([{ checkKey: "pressure_wash", state: "todo", dueDate: null }]);
  });

  it("taking a job off the calendar resets the checks of the bookings removed", async () => {
    h.fake.queue({
      "select:projects": [[project("scheduled")]],
      "update:schedule_entries": [[{ id: E, kind: "pressure_wash" }, { id: E2, kind: "work" }]],
      "select:schedule_entries": [[AGG], []],
      "select:project_readiness": [booked("2026-10-27")],
    });
    expect(await removeProjectEntries({ projectId: P }, ACTOR)).toEqual({ removed: 2 });
    expect(readinessWrites()).toEqual([{ checkKey: "pressure_wash", state: "todo", dueDate: null }]);
  });

  it("leaves the office's Done alone, and painting bookings never touch the checks", async () => {
    h.fake.queue({
      "select:schedule_entries": [[rawEntry(PW)], [AGG], []],
      "select:projects": [[project("need_to_schedule")]],
      "update:schedule_entries": [[{ id: E }]],
      "select:project_readiness": [booked("2026-10-27", "done")],
    });
    await deleteEntry({ id: E, version: 1 }, ACTOR);
    expect(readinessWrites()).toEqual([]);

    h.fake.reset();
    h.fake.queue({
      "select:schedule_entries": [[rawEntry()], [AGG]],
      "select:projects": [[project("scheduled")]],
      "update:schedule_entries": [[{ id: E }]],
    });
    await deleteEntry({ id: E, version: 1 }, ACTOR);
    expect(h.fake.find("select", "project_readiness")).toEqual([]);
    expect(readinessWrites()).toEqual([]);
  });
});

describe("splitting a booking", () => {
  const cal = calendarsFor(defaultScheduleSettings(), "2026-10-01", "2026-11-30").calFor(null);

  it("shares planned hours by working days: 12.00 over 3 + 2 days → 7.20 / 4.80", () => {
    expect(planSplit({ startDate: "2026-10-26", endDate: "2026-10-30", plannedHours: "12.00" }, "2026-10-28", cal)).toEqual({
      first: { startDate: "2026-10-26", endDate: "2026-10-28", plannedHours: "7.20" },
      second: { startDate: "2026-10-29", endDate: "2026-10-30", plannedHours: "4.80" },
    });
  });

  it("starts the second part on the next working day, and refuses a day outside the booking", () => {
    const r = planSplit({ startDate: "2026-10-22", endDate: "2026-10-27", plannedHours: null }, "2026-10-23", cal)!;
    expect(r.second).toEqual({ startDate: "2026-10-26", endDate: "2026-10-27", plannedHours: null });
    expect(planSplit({ startDate: "2026-10-22", endDate: "2026-10-27", plannedHours: null }, "2026-10-27", cal)).toBeNull();
    expect(planSplit({ startDate: "2026-10-22", endDate: "2026-10-27", plannedHours: null }, "2026-10-21", cal)).toBeNull();
  });

  it("splitEntry writes both parts", async () => {
    h.fake.queue({
      "select:schedule_entries": [[rawEntry({ plannedHours: "12.00" })], [{ first: "2026-10-26", last: "2026-10-30", n: 2 }], [entryRow({ endDate: "2026-10-28" })], [entryRow({ id: E2, startDate: "2026-10-29" })]],
      "select:projects": [[project("scheduled")]],
      "update:schedule_entries": [[{ id: E }]],
      "insert:schedule_entries": [[{ id: E2 }]],
    });
    const r = await splitEntry({ id: E, version: 1, firstPartEnd: "2026-10-28" }, ACTOR);
    expect(h.fake.find("update", "schedule_entries")[0].args.set[0]).toMatchObject({ endDate: "2026-10-28", plannedHours: "7.20" });
    expect(h.fake.find("insert", "schedule_entries")[0].args.values[0]).toMatchObject({ projectId: P, startDate: "2026-10-29", endDate: "2026-10-30", plannedHours: "4.80" });
    expect(r.entries.map((e) => e.id)).toEqual([E, E2]);
    expect(h.hooks).toEqual([{ kind: "split", projectId: P, entryIds: [E, E2], actorId: "user-pm" }]);
  });
});

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb, audits: [] as { action: string; before?: unknown; after?: unknown }[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: { action: string }) => void h.audits.push(e) }));
vi.mock("./schedule-settings", async () => {
  const { defaultScheduleSettings } = await import("@/lib/schedule/settings-schema");
  return { getScheduleSettings: async () => defaultScheduleSettings() };
});

const { getReadinessItems, getReadinessSummaries, ReadinessError, setReadinessItem, syncLinkedReadiness } = await import("./readiness");
const { DEFAULT_READINESS_CHECKS } = await import("@/lib/schedule/settings-schema");

const P = "00000000-0000-4000-8000-000000000001";
const ACTOR = { id: "user-pm" };

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
});

describe("setReadinessItem", () => {
  it("refuses a check that isn't in the settings", async () => {
    await expect(setReadinessItem({ projectId: P, checkKey: "retired_check", state: "done" }, ACTOR)).rejects.toBeInstanceOf(ReadinessError);
    expect(h.fake.calls).toEqual([]);
  });

  it("keeps the saved note and date when only the state changes, and audits before/after", async () => {
    h.fake.queue({ "select:projects": [[{ id: P }]], "select:project_readiness": [[{ state: "in_progress", dueDate: "2026-10-23", note: "SW order #12" }]] });
    const item = await setReadinessItem({ projectId: P, checkKey: "paint", state: "done" }, ACTOR);
    expect(item).toMatchObject({ key: "paint", state: "done", stateLabel: "Received", dueDate: "2026-10-23", note: "SW order #12" });
    expect(h.fake.find("insert", "project_readiness")[0].args.values[0]).toMatchObject({ projectId: P, checkKey: "paint", state: "done", note: "SW order #12", updatedBy: "user-pm" });
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "schedule.readiness.set",
        before: { checkKey: "paint", state: "in_progress", dueDate: "2026-10-23", note: "SW order #12" },
        after: { checkKey: "paint", state: "done", dueDate: "2026-10-23", note: "SW order #12" },
      }),
    ]);
  });

  it("clears the note when asked", async () => {
    h.fake.queue({ "select:projects": [[{ id: P }]], "select:project_readiness": [[{ state: "todo", dueDate: null, note: "old" }]] });
    expect((await setReadinessItem({ projectId: P, checkKey: "deposit", state: "done", note: "" }, ACTOR)).note).toBeNull();
  });
});

describe("syncLinkedReadiness", () => {
  it("books the pressure-wash check, with an audit entry, and leaves other kinds alone", async () => {
    await syncLinkedReadiness(h.fake.db, { projectId: P, changedKinds: ["pressure_wash"], bookings: [{ kind: "pressure_wash", startDate: "2026-10-22" }], checks: DEFAULT_READINESS_CHECKS, actorId: "user-pm" });
    expect(h.fake.find("insert", "project_readiness")[0].args.values[0]).toMatchObject({ projectId: P, checkKey: "pressure_wash", state: "in_progress", dueDate: "2026-10-22", updatedBy: "user-pm" });
    expect(h.audits).toEqual([
      expect.objectContaining({ action: "schedule.readiness.linked", before: { checkKey: "pressure_wash", state: "todo", dueDate: null }, after: { checkKey: "pressure_wash", state: "in_progress", dueDate: "2026-10-22" } }),
    ]);
    h.fake.reset();
    await syncLinkedReadiness(h.fake.db, { projectId: P, changedKinds: ["work"], bookings: [], checks: DEFAULT_READINESS_CHECKS, actorId: "user-pm" });
    expect(h.fake.calls).toEqual([]);
  });

  it("puts a booked check back to the start when its last booking is gone", async () => {
    h.fake.queue({ "select:project_readiness": [[{ projectId: P, checkKey: "colour_consult", state: "in_progress", dueDate: "2026-10-22", note: "Bring the fan deck" }]] });
    await syncLinkedReadiness(h.fake.db, { projectId: P, changedKinds: ["colour_consult"], bookings: [], checks: DEFAULT_READINESS_CHECKS, actorId: "user-pm" });
    const write = h.fake.find("insert", "project_readiness")[0].args;
    expect(write.values[0]).toMatchObject({ checkKey: "colour_consult", state: "todo", dueDate: null });
    // The note stays: only the state and date follow the calendar.
    expect(write.onConflictDoUpdate[0]).toMatchObject({ set: { state: "todo", dueDate: null } });
    expect(Object.keys((write.onConflictDoUpdate[0] as { set: object }).set)).not.toContain("note");
  });
});

describe("what the checklist shows", () => {
  afterEach(() => vi.useRealTimers());

  /** A pressure wash booked through Oct 22, 2026, as seen at `instant`. */
  async function pressureWashAt(instant: string) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(instant));
    h.fake.reset();
    h.fake.otherwise((c) =>
      c.table === "project_readiness" ? [{ projectId: P, checkKey: "pressure_wash", state: "in_progress", dueDate: "2026-10-22", note: null }]
      : c.table === "schedule_entries" ? [{ projectId: P, kind: "pressure_wash", last: "2026-10-22" }]
      : [],
    );
    const item = (await getReadinessItems(P)).find((i) => i.key === "pressure_wash")!;
    const summary = (await getReadinessSummaries([P], DEFAULT_READINESS_CHECKS))[P];
    return { state: item.state, missing: summary.missing.includes("Pressure washing") };
  }

  it("counts a pressure wash as done from the morning after its booked day, Vancouver time", async () => {
    // 11:59 pm on Oct 22 and midnight on Oct 23 in Vancouver (UTC−7).
    expect(await pressureWashAt("2026-10-23T06:59:00Z")).toEqual({ state: "in_progress", missing: true });
    expect(await pressureWashAt("2026-10-23T07:00:00Z")).toEqual({ state: "done", missing: false });
  });

  it("asks only for the last booked day of each pressure wash, ignoring removed bookings", async () => {
    await pressureWashAt("2026-10-23T19:00:00Z");
    const q = new PgDialect().sqlToQuery(h.fake.find("select", "schedule_entries")[0].args.where[0] as SQL);
    expect(q.sql).toMatch(/"schedule_entries"\."deleted_at" is null/);
    expect(q.params).toEqual([P, "pressure_wash"]);
  });
});

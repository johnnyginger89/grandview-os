import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { applyLinkedReadiness, ReadinessError, setReadinessItem } = await import("./readiness");
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

describe("applyLinkedReadiness", () => {
  it("books the pressure-wash check from todo, and leaves other kinds alone", async () => {
    await applyLinkedReadiness(h.fake.db, { projectId: P, kind: "pressure_wash", startDate: "2026-10-22", checks: DEFAULT_READINESS_CHECKS, actorId: "user-pm" });
    expect(h.fake.find("insert", "project_readiness")[0].args.values[0]).toMatchObject({ checkKey: "pressure_wash", state: "in_progress", dueDate: "2026-10-22" });
    h.fake.reset();
    await applyLinkedReadiness(h.fake.db, { projectId: P, kind: "work", startDate: "2026-10-22", checks: DEFAULT_READINESS_CHECKS, actorId: "user-pm" });
    expect(h.fake.calls).toEqual([]);
  });
});

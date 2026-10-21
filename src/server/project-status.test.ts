import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const transaction = vi.fn();
vi.mock("@/db", () => ({ db: { transaction: (fn: (tx: unknown) => unknown) => transaction(fn) } }));

const { activities, auditLog, projects, projectStatusEvents } = await import("@/db/schema");
const { changeProjectStatus, createSoldProject, effectiveInstant, planStatusChange, ProjectStatusError, setCompletionDate } = await import("./project-status");
type Tx = import("./project-status").Tx;

// Oct 20 2026, 12:00 PDT.
const NOW = new Date("2026-10-20T19:00:00Z");
const SOLD = new Date("2026-10-03T17:30:00Z");
const base = { status: "in_progress" as const, soldAt: SOLD, completedAt: null, cancelledAt: null };

afterEach(() => {
  vi.useRealTimers();
});

describe("planStatusChange", () => {
  it("is a no-op for the same status", () => {
    expect(planStatusChange(base, "in_progress", {}, NOW)).toBeNull();
  });

  it("sets the finish date when a job is completed: today = now, a past day = local noon", () => {
    const today = planStatusChange(base, "complete", { date: "2026-10-20" }, NOW)!;
    expect(today.set).toEqual({ status: "complete", completedAt: NOW, updatedAt: NOW });
    expect(today.effectiveAt).toBe(NOW);
    expect(planStatusChange(base, "complete", {}, NOW)!.set.completedAt).toBe(NOW);
    const past = planStatusChange(base, "complete", { date: "2026-10-14" }, NOW)!;
    expect(past.set.completedAt?.toISOString()).toBe("2026-10-14T19:00:00.000Z");
    // Noon after the DST change is 20:00Z, still Nov 1 locally.
    const later = planStatusChange({ ...base, soldAt: new Date("2026-10-30T18:00:00Z") }, "complete", { date: "2026-11-01" }, new Date("2026-11-03T19:00:00Z"))!;
    expect(later.set.completedAt?.toISOString()).toBe("2026-11-01T20:00:00.000Z");
  });

  it("keeps the finish date between finished statuses", () => {
    const done = { ...base, status: "complete" as const, completedAt: new Date("2026-10-14T19:00:00Z") };
    const p = planStatusChange(done, "invoiced", { date: "2026-10-20" }, NOW)!;
    expect(p.set).toEqual({ status: "invoiced", updatedAt: NOW });
    expect(p.reopened).toBe(false);
  });

  it("clears the finish date when a finished job is reopened", () => {
    const done = { ...base, status: "complete" as const, completedAt: new Date("2026-10-14T19:00:00Z") };
    const p = planStatusChange(done, "in_progress", {}, NOW)!;
    expect(p.set).toEqual({ status: "in_progress", completedAt: null, updatedAt: NOW });
    expect(p.reopened).toBe(true);
  });

  it("refuses to cancel a finished job and requires a reason otherwise", () => {
    const done = { ...base, status: "invoiced" as const, completedAt: new Date("2026-10-14T19:00:00Z") };
    expect(() => planStatusChange(done, "cancelled", { note: "Customer changed mind" }, NOW)).toThrow(/Reopen it first/);
    expect(() => planStatusChange(base, "cancelled", { note: "  " }, NOW)).toThrow(/reason/);
    expect(() => planStatusChange(base, "cancelled", { note: "x".repeat(501) }, NOW)).toThrow(/500/);
    const c = planStatusChange(base, "cancelled", { note: "Customer moved" }, NOW)!;
    expect(c.set).toEqual({ status: "cancelled", cancelledAt: NOW, updatedAt: NOW });
  });

  it("clears the cancellation when a job is reinstated", () => {
    const cancelled = { ...base, status: "cancelled" as const, cancelledAt: new Date("2026-10-10T19:00:00Z") };
    expect(planStatusChange(cancelled, "scheduled", {}, NOW)!.set).toEqual({ status: "scheduled", cancelledAt: null, updatedAt: NOW });
    expect(planStatusChange(cancelled, "complete", {}, NOW)!.set).toEqual({ status: "complete", cancelledAt: null, completedAt: NOW, updatedAt: NOW });
  });

  it("changes nothing else for on hold", () => {
    expect(planStatusChange(base, "on_hold", {}, NOW)!.set).toEqual({ status: "on_hold", updatedAt: NOW });
  });

  it("bounds the date to [sold date, today] in Vancouver", () => {
    expect(() => planStatusChange(base, "complete", { date: "2026-10-21" }, NOW)).toThrow("Finish date can't be in the future.");
    expect(() => planStatusChange(base, "complete", { date: "2026-10-02" }, NOW)).toThrow("Finish date can't be before the job was sold (Oct 3, 2026).");
    expect(() => planStatusChange(base, "complete", { date: "2026-02-30" }, NOW)).toThrow(ProjectStatusError);
    // 23:30 on Oct 31 local is already Nov 1 in UTC; Nov 1 is still the future there.
    const lateEvening = new Date("2026-11-01T06:30:00Z");
    expect(() => planStatusChange(base, "complete", { date: "2026-11-01" }, lateEvening)).toThrow(/future/);
    expect(planStatusChange(base, "complete", { date: "2026-10-31" }, lateEvening)!.set.completedAt).toBe(lateEvening);
    // A finish on the sale day itself never lands before the sale.
    const soldLate = { ...base, soldAt: new Date("2026-10-03T23:00:00Z") };
    expect(effectiveInstant(soldLate, "2026-10-03", NOW)).toEqual(soldLate.soldAt);
  });

  it("rejects unknown statuses", () => {
    expect(() => planStatusChange(base, "done" as never, {}, NOW)).toThrow(ProjectStatusError);
  });
});

/** A fake drizzle transaction that records every query. */
function fakeTx(project: Record<string, unknown> | null, inserted: Record<string, unknown> | null = null) {
  const calls: { op: string; table?: unknown; set?: Record<string, unknown>; values?: Record<string, unknown>; lock?: string }[] = [];
  const builder = (op: string, table?: unknown) => {
    const rec: (typeof calls)[number] = { op, table };
    calls.push(rec);
    const b = {
      from: (t: unknown) => ((rec.table = t), b),
      where: () => b,
      for: (m: string) => ((rec.lock = m), b),
      set: (v: Record<string, unknown>) => ((rec.set = v), b),
      values: (v: Record<string, unknown>) => ((rec.values = v), b),
      onConflictDoNothing: () => b,
      returning: () => b,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const result = op === "select" ? (project ? [project] : []) : op === "insert" && table === projects ? (inserted ? [inserted] : []) : undefined;
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return b;
  };
  const tx = { select: () => builder("select"), update: (t: unknown) => builder("update", t), insert: (t: unknown) => builder("insert", t) };
  return { tx: tx as unknown as Tx, calls };
}
const writes = (calls: ReturnType<typeof fakeTx>["calls"]) => calls.filter((c) => c.op !== "select");

const ID = "7f3c1e9a-2b4d-4c6e-8f10-123456789abc";
const row = { id: ID, number: 3007, status: "in_progress", soldAt: SOLD, completedAt: null, cancelledAt: null, customerId: "c1", opportunityId: "o1" };

describe("changeProjectStatus", () => {
  beforeEach(() => {
    transaction.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  it("runs inside the caller's transaction without opening its own", async () => {
    const { tx, calls } = fakeTx(row);
    const r = await changeProjectStatus(ID, "complete", { actorId: "u1", effectiveDate: "2026-10-14" }, tx);
    expect(transaction).not.toHaveBeenCalled();
    expect(r).toMatchObject({ changed: true, status: "complete", reopened: false });
    expect(r.completedAt?.toISOString()).toBe("2026-10-14T19:00:00.000Z");
    expect(calls[0]).toMatchObject({ op: "select", table: projects, lock: "update" });
    const w = writes(calls);
    expect(w.map((c) => [c.op, c.table])).toEqual([
      ["update", projects],
      ["insert", projectStatusEvents],
      ["insert", auditLog],
      ["insert", activities],
    ]);
    expect(w[0].set).toMatchObject({ status: "complete", updatedAt: NOW });
    expect(w[1].values).toMatchObject({ projectId: ID, fromStatus: "in_progress", toStatus: "complete", changedBy: "u1", source: "app" });
    expect(w[2].values).toMatchObject({ action: "project.status", entityId: ID, before: { status: "in_progress", completedAt: null } });
    expect(w[3].values).toMatchObject({ type: "system", body: "Project #3007 moved from In progress to Complete (finished Oct 14, 2026)" });
  });

  it("opens its own transaction when none is given", async () => {
    const { tx, calls } = fakeTx(row);
    transaction.mockImplementation((fn: (t: Tx) => unknown) => fn(tx));
    const r = await changeProjectStatus(ID, "cancelled", { actorId: "u1", note: "Customer sold the house" });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ changed: true, status: "cancelled", cancelledAt: NOW });
    expect(writes(calls).map((c) => c.table)).toEqual([projects, projectStatusEvents, auditLog, activities]);
    expect(writes(calls)[1].values).toMatchObject({ note: "Customer sold the house" });
  });

  it("writes nothing when the status is unchanged", async () => {
    const { tx, calls } = fakeTx(row);
    const r = await changeProjectStatus(ID, "in_progress", { actorId: "u1" }, tx);
    expect(r).toEqual({ changed: false, status: "in_progress", completedAt: null, cancelledAt: null, reopened: false });
    expect(writes(calls)).toEqual([]);
  });

  it("reports a missing project as a user-facing error", async () => {
    const { tx } = fakeTx(null);
    await expect(changeProjectStatus(ID, "complete", { actorId: "u1" }, tx)).rejects.toThrow("Project not found.");
    await expect(changeProjectStatus("not-a-uuid", "complete", { actorId: "u1" }, tx)).rejects.toThrow("Project not found.");
  });
});

describe("setCompletionDate", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  it("moves the finish date of a finished job and records it", async () => {
    const { tx, calls } = fakeTx({ ...row, status: "complete", completedAt: NOW });
    const r = await setCompletionDate(ID, "2026-10-14", "u1", tx);
    expect(r.completedAt.toISOString()).toBe("2026-10-14T19:00:00.000Z");
    const w = writes(calls);
    expect(w.map((c) => c.table)).toEqual([projects, projectStatusEvents, auditLog]);
    expect(w[0].set).toEqual({ completedAt: r.completedAt, updatedAt: NOW });
    expect(w[1].values).toMatchObject({ fromStatus: "complete", toStatus: "complete", note: "Finish date changed" });
    expect(w[2].values).toMatchObject({ action: "project.completion_date" });
  });

  it("refuses unfinished jobs and dates out of range", async () => {
    await expect(setCompletionDate(ID, "2026-10-14", "u1", fakeTx(row).tx)).rejects.toThrow(/finished job/);
    await expect(setCompletionDate(ID, "2026-10-21", "u1", fakeTx({ ...row, status: "complete", completedAt: NOW }).tx)).rejects.toThrow(/future/);
  });
});

describe("createSoldProject", () => {
  it("creates the project sold at the signing time with its first history event", async () => {
    const signedAt = new Date("2026-10-20T18:00:00Z");
    const { tx, calls } = fakeTx(null, { id: ID, status: "need_to_schedule" });
    const values = { name: "[TEST DATA] Job", customerId: "c1", contractPrice: "3000.00", contractTotal: "3150.00" };
    const p = await createSoldProject(values, { soldAt: signedAt, actorId: null, note: "Proposal signed" }, tx);
    expect(p).toMatchObject({ id: ID });
    const w = writes(calls);
    expect(w[0]).toMatchObject({ op: "insert", table: projects, values: { ...values, status: "need_to_schedule", soldAt: signedAt } });
    expect(w[1]).toMatchObject({ op: "insert", table: projectStatusEvents, values: { projectId: ID, fromStatus: null, toStatus: "need_to_schedule", effectiveAt: signedAt } });
  });

  it("does nothing more when the estimate already has a project", async () => {
    const { tx, calls } = fakeTx(null, null);
    expect(await createSoldProject({ name: "x", customerId: "c1", contractPrice: "1", contractTotal: "1" }, { soldAt: NOW, actorId: null }, tx)).toBeNull();
    expect(writes(calls)).toHaveLength(1);
  });
});

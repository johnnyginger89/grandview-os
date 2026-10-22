import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb, locked: true, failures: 0, executed: [] as unknown[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  const execute = h.fake.db.execute;
  h.fake.db.execute = (q: unknown) => (h.executed.push(q), execute(q));
  return { db: h.fake.db };
});

const { limitedAttempt } = await import("./attempt-limit");
const dialect = new PgDialect({ casing: "snake_case" });
const render = (s: unknown) => dialect.sqlToQuery(s as SQL);
const NOW = new Date("2026-10-22T18:00:00Z");
const rule = (actorId: string | null) => ({ key: "authenticator-code:u1", failures: ["a.failed", "b.failed"], actorId, max: 5, windowMs: 15 * 60_000 });

beforeEach(() => {
  h.fake.reset();
  h.executed = [];
  h.locked = true;
  h.failures = 0;
  h.fake.otherwise((call) => (call.op === "execute" ? { rows: [{ locked: h.locked }] } : call.op === "select" ? [{ n: h.failures }] : []));
});

describe("limited attempts", () => {
  it("holds a transaction-scoped lock for the key while it counts and runs the try", async () => {
    const attempt = vi.fn(async () => "checked");
    expect(await limitedAttempt(rule("u1"), NOW, attempt)).toEqual({ status: "ran", value: "checked" });
    expect(h.executed).toHaveLength(1);
    const lock = render(h.executed[0]);
    expect(lock.sql).toContain("pg_try_advisory_xact_lock(hashtext($1))");
    expect(lock.params).toEqual(["grandview-os:authenticator-code:u1"]);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("counts this person's wrong tries of every listed kind in the window", async () => {
    await limitedAttempt(rule("u1"), NOW, async () => null);
    const q = render(h.fake.find("select", "audit_log")[0].args.where[0]);
    expect(q.sql).toBe('("audit_log"."action" in ($1, $2) and "audit_log"."created_at" >= $3 and "audit_log"."actor_id" = $4)');
    expect(q.params).toEqual(["a.failed", "b.failed", new Date(NOW.getTime() - 15 * 60_000).toISOString(), "u1"]);
  });

  it("counts everyone's wrong tries when no person is given", async () => {
    await limitedAttempt(rule(null), NOW, async () => null);
    const q = render(h.fake.find("select", "audit_log")[0].args.where[0]);
    expect(q.sql).not.toContain("actor_id");
  });

  it("stops at the limit without running the try", async () => {
    h.failures = 5;
    const attempt = vi.fn(async () => "checked");
    expect(await limitedAttempt(rule("u1"), NOW, attempt)).toEqual({ status: "limited" });
    expect(attempt).not.toHaveBeenCalled();
    h.failures = 4;
    expect(await limitedAttempt(rule("u1"), NOW, attempt)).toEqual({ status: "ran", value: "checked" });
  });

  it("turns a try away unchecked while another one holds the lock", async () => {
    h.locked = false;
    const attempt = vi.fn(async () => "checked");
    expect(await limitedAttempt(rule("u1"), NOW, attempt)).toEqual({ status: "busy" });
    expect(attempt).not.toHaveBeenCalled();
    expect(h.fake.find("select", "audit_log")).toEqual([]);
  });
});

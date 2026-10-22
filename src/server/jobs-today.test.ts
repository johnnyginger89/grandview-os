import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});

const { jobsToday } = await import("./jobs-today");

const dialect = new PgDialect();
const query = () => {
  const call = h.fake.find("select", "schedule_entries")[0];
  return { ...dialect.sqlToQuery(call.args.where[0] as SQL), columns: Object.keys(call.args.selectDistinct?.[0] ?? {}) };
};
/** The Vancouver day the count was asked for. */
async function dayAt(instant: string): Promise<string> {
  h.fake.reset();
  await jobsToday(new Date(instant), { money: false });
  const days = query().params.filter((p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p));
  expect(new Set(days).size, instant).toBe(1);
  return days[0];
}

beforeEach(() => h.fake.reset());

describe("jobs today", () => {
  it("counts painting bookings that cover today's calendar day, so a job counts all of its last day", async () => {
    await jobsToday(new Date("2026-10-30T19:00:00Z"), { money: false });
    const q = query();
    // Booking days are dates (end inclusive): start ≤ today ≤ end. Never the projects' start/end instants.
    expect(q.sql).toMatch(/"schedule_entries"\."start_date" <= \$\d+/);
    expect(q.sql).toMatch(/"schedule_entries"\."end_date" >= \$\d+/);
    expect(q.sql).toMatch(/"schedule_entries"\."deleted_at" is null/);
    expect(q.sql).not.toMatch(/"projects"\."(start|end)_date"/);
    expect(q.params).toEqual(expect.arrayContaining(["work", "2026-10-30", "scheduled", "in_progress", "walk_through"]));
    expect(q.params).not.toContain("on_hold");
  });

  it("uses the Vancouver day around midnight", async () => {
    // 11:59 pm and midnight on Oct 30, 2026 (UTC−7).
    expect(await dayAt("2026-10-31T06:59:00Z")).toBe("2026-10-30");
    expect(await dayAt("2026-10-31T07:00:00Z")).toBe("2026-10-31");
    expect(await dayAt("2026-10-30T07:00:00Z")).toBe("2026-10-30");
    expect(await dayAt("2026-10-30T06:59:59Z")).toBe("2026-10-29");
  });

  it("uses the Vancouver day across the clock changes", async () => {
    // Spring forward on Mar 8, 2026: midnight is at 08:00 UTC that day, the next midnight at 07:00 UTC.
    expect(await dayAt("2026-03-08T07:59:00Z")).toBe("2026-03-07");
    expect(await dayAt("2026-03-08T08:00:00Z")).toBe("2026-03-08");
    expect(await dayAt("2026-03-09T06:59:00Z")).toBe("2026-03-08");
    expect(await dayAt("2026-03-09T07:00:00Z")).toBe("2026-03-09");
    // Fall back on Nov 2, 2025: midnight is at 07:00 UTC that day, the next midnight at 08:00 UTC.
    expect(await dayAt("2025-11-02T06:59:00Z")).toBe("2025-11-01");
    expect(await dayAt("2025-11-02T07:00:00Z")).toBe("2025-11-02");
    expect(await dayAt("2025-11-03T07:59:00Z")).toBe("2025-11-02");
    expect(await dayAt("2025-11-03T08:00:00Z")).toBe("2025-11-03");
  });

  it("adds up contract prices once per job, and only reads them for people who may see money", async () => {
    h.fake.queue({ "select:schedule_entries": [[{ projectId: "p-1", price: "3000.00" }, { projectId: "p-2", price: "12500.10" }]] });
    expect(await jobsToday(new Date("2026-10-30T19:00:00Z"), { money: true })).toEqual({ count: 2, value: "15500.10" });
    expect(query().columns).toEqual(["projectId", "price"]);

    h.fake.reset();
    h.fake.queue({ "select:schedule_entries": [[{ projectId: "p-1" }]] });
    expect(await jobsToday(new Date("2026-10-30T19:00:00Z"), { money: false })).toEqual({ count: 1, value: null });
    expect(query().columns).toEqual(["projectId"]);
  });
});

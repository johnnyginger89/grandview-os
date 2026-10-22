import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});

const { listProjects } = await import("./project-list");

const dialect = new PgDialect({ casing: "snake_case" });
const rowsCall = () => h.fake.calls.find((c) => c.table === "projects" && c.args.limit)!;
const countCall = () => h.fake.calls.find((c) => c.table === "projects" && !c.args.limit)!;

const job = { id: "p1", number: 3101, name: "Jordan Sample – Exterior repaint", status: "scheduled", customer: "Jordan Sample [TEST DATA]", city: "Surrey", startDate: null, contractTotal: "3150.00" };

beforeEach(() => {
  h.fake.reset();
  h.fake.otherwise((c) => (c.args.limit ? [job] : [{ n: 450 }]));
});

describe("listProjects", () => {
  it("pages the jobs, newest first", async () => {
    const p = await listProjects({ page: 5, includeMoney: true });
    expect(p).toMatchObject({ page: 5, pages: 5, total: 450, from: 401 });
    expect(rowsCall().args.limit).toEqual([100]);
    expect(rowsCall().args.offset).toEqual([400]);
    expect(dialect.sqlToQuery(sql.join(rowsCall().args.orderBy as SQL[], sql`, `)).sql).toBe('"projects"."created_at" desc, "projects"."number" desc');
    // Counted over the same join as the list.
    expect(countCall().args.innerJoin).toBeDefined();
  });

  it("gives the contract total only to roles that may see money", async () => {
    expect((await listProjects({ includeMoney: true })).rows[0].contractTotal).toBe("3150.00");
    const [hidden] = (await listProjects({ includeMoney: false })).rows;
    expect(hidden.contractTotal).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain("3150");
  });
});

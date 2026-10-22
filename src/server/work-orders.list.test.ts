/** The Work orders page list (listAllWorkOrders); the rest of the service is in work-orders.test.ts. */
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async () => {} }));
vi.mock("./settings", () => ({ getCompany: async () => ({}), getProposalTemplate: async () => ({}), getSetting: async (_k: string, fallback: unknown) => fallback, setSetting: async () => {} }));

const { listAllWorkOrders } = await import("./work-orders");

const dialect = new PgDialect({ casing: "snake_case" });
const render = (s: SQL) => dialect.sqlToQuery(s);
const rowsCall = () => h.fake.find("select", "work_orders").find((c) => c.args.limit)!;
const countCall = () => h.fake.find("select", "work_orders").find((c) => !c.args.limit)!;
const where = (c: FakeCall) => (c.args.where[0] ? render(c.args.where[0] as SQL) : null);

const NOW = new Date("2026-10-22T18:00:00Z");
const row = { id: "w1", number: 7001, title: "Interior repaint", status: "issued", currentVersion: 2, crewName: null, projectId: "p1", projectNumber: 3018, customerName: "[TEST DATA] Kim Lee", issuedAt: NOW, activeLinks: "2", updatedAt: NOW };

beforeEach(() => {
  h.fake.reset();
  h.fake.otherwise((c) => (c.table !== "work_orders" ? [] : c.args.limit ? [row] : [{ n: 250 }]));
});

describe("listAllWorkOrders", () => {
  it("pages 100 at a time, most recently changed first", async () => {
    const p = await listAllWorkOrders({ page: 3 }, NOW);
    expect(p).toMatchObject({ page: 3, pages: 3, total: 250, from: 201 });
    expect(rowsCall().args.limit).toEqual([100]);
    expect(rowsCall().args.offset).toEqual([200]);
    expect(render(sql.join(rowsCall().args.orderBy as SQL[], sql`, `)).sql).toBe('"work_orders"."updated_at" desc, "work_orders"."number" desc');
    expect(p.rows[0]).toMatchObject({ number: "WO-7001", currentVersion: 2, issuedAt: NOW.toISOString(), activeLinks: 2, updatedAt: NOW.toISOString() });
  });

  it("counts and lists the same status", async () => {
    await listAllWorkOrders({ status: "draft" }, NOW);
    expect(where(rowsCall())).toMatchObject({ sql: '"work_orders"."status" = $1', params: ["draft"] });
    expect(where(countCall())).toEqual(where(rowsCall()));

    h.fake.reset();
    h.fake.otherwise((c) => (c.args.limit ? [] : [{ n: 0 }]));
    expect(await listAllWorkOrders({}, NOW)).toMatchObject({ rows: [], total: 0, from: 0, to: 0 });
    expect(where(countCall())).toBeNull();
  });
});

import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});

const { listEstimates } = await import("./estimate-list");

const dialect = new PgDialect({ casing: "snake_case" });
const render = (s: SQL) => dialect.sqlToQuery(s);
// The proposal-views subquery is built with db.select() too, but is never awaited on its own.
const rowsCall = () => h.fake.calls.find((c) => c.table === "estimates" && c.args.limit)!;
const countCall = () => h.fake.calls.find((c) => c.table === "estimates" && !c.args.limit)!;
const where = (c: FakeCall) => render(c.args.where[0] as SQL);

const SENT = new Date("2026-10-20T18:00:00Z");
const CREATED = new Date("2026-09-30T18:00:00Z");
const estimate = (extra: Record<string, unknown> = {}) => ({
  id: "e1", number: 5012, title: "Deck stain", status: "sent", customer: "Jordan Sample [TEST DATA]", totalWithTax: "3150.00",
  totalPrice: "3000.00", totalCost: "1800.00", totalHours: "24.5000", sentAt: SENT, createdAt: CREATED, firstViewedAt: null, viewCount: null, ...extra,
});

function estimatesInDb(total: number, rows = [estimate()]) {
  h.fake.otherwise((c) => (c.table !== "estimates" ? [] : c.args.limit ? rows : [{ n: total }]));
}

beforeEach(() => h.fake.reset());

describe("listEstimates", () => {
  it("pages 100 at a time, most recently sent or created first", async () => {
    estimatesInDb(1240);
    const p = await listEstimates({ page: 3, costing: true });
    expect(p).toMatchObject({ page: 3, pages: 13, total: 1240, from: 201, to: 201 });
    expect(rowsCall().args.limit).toEqual([100]);
    expect(rowsCall().args.offset).toEqual([200]);
    expect(render(sql.join(rowsCall().args.orderBy as SQL[], sql`, `)).sql).toBe('coalesce("estimates"."sent_at", "estimates"."created_at") desc, "estimates"."number" desc');
  });

  it("gives margin and hours only to roles that see costing", async () => {
    estimatesInDb(1);
    const [withCosting] = (await listEstimates({ costing: true })).rows;
    expect(withCosting.costing).toEqual({ margin: "0.4000", hours: "24.5000" });

    h.fake.reset();
    estimatesInDb(1);
    const [without] = (await listEstimates({ costing: false })).rows;
    expect(without.costing).toBeNull();
    expect(JSON.stringify(without)).not.toContain("1800");
    expect(without.totalWithTax).toBe("3150.00");
  });

  it("lists by the sent date when there is one, and counts the customer's opens", async () => {
    estimatesInDb(2, [estimate({ viewCount: "3", firstViewedAt: SENT }), estimate({ id: "e2", status: "draft", sentAt: null })]);
    const { rows } = await listEstimates({ costing: false });
    expect(rows[0]).toMatchObject({ listedAt: SENT, viewCount: 3, firstViewedAt: SENT });
    expect(rows[1]).toMatchObject({ listedAt: CREATED, viewCount: 0 });
  });

  it("filters by status and searches customer, title or number; the total counts the same", async () => {
    estimatesInDb(1);
    await listEstimates({ status: "sent", q: "EST-5012", costing: true });
    const w = where(rowsCall());
    expect(w.sql).toContain('"estimates"."status" = $1');
    expect(w.sql).toContain('"customers"."display_name" ilike');
    expect(w.sql).toContain('"estimates"."title" ilike');
    expect(w.params).toEqual(["sent", "%EST-5012%", "%EST-5012%", "%5012%"]);
    expect(where(countCall())).toEqual(w);
    expect(countCall().args.innerJoin).toBeDefined();
  });

  it("treats % and _ in the search as plain characters", async () => {
    estimatesInDb(1);
    await listEstimates({ q: "50%_off", costing: true });
    expect(where(rowsCall()).params).toContain("%50\\%\\_off%");
  });
});

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
vi.mock("@/server/settings", () => ({ getProposalTemplate: async () => ({ estimateDocument: { numberPrefix: "EST-" } }) }));

const { listCustomers } = await import("./customer-list");
const { customerMatches } = await import("./search");
const { parseSearchQuery } = await import("@/lib/search/query");

const dialect = new PgDialect({ casing: "snake_case" });
const render = (s: SQL) => dialect.sqlToQuery(s);
const rowsCall = () => h.fake.calls.find((c) => c.table === "customers" && c.args.limit)!;
const countCall = () => h.fake.calls.find((c) => c.table === "customers" && !c.args.limit)!;
const where = (c: FakeCall) => render(c.args.where[0] as SQL);
const orderBy = (c: FakeCall) => render(sql.join(c.args.orderBy as SQL[], sql`, `)).sql;

/** `total` customers; each query gets its slice, the count gets the total. */
function customersInDb(total: number) {
  h.fake.otherwise((c) => {
    if (!c.args.limit) return [{ n: total }];
    const [limit] = c.args.limit as number[];
    const [offset] = c.args.offset as number[];
    return Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
      id: `c${offset + i + 1}`, name: `Sample ${offset + i + 1} [TEST DATA]`, type: "residential", email: null, phone: null, tags: [], city: "Surrey", createdAt: new Date("2026-10-01T17:00:00Z"),
    }));
  });
}

beforeEach(() => h.fake.reset());

describe("listCustomers paging", () => {
  it("shows 100 a page, newest first, with the total", async () => {
    customersInDb(240);
    const p = await listCustomers({ page: 2 });
    expect(p).toMatchObject({ page: 2, pages: 3, total: 240, from: 101, to: 200 });
    expect(p.rows[0].id).toBe("c101");
    expect(rowsCall().args.limit).toEqual([100]);
    expect(rowsCall().args.offset).toEqual([100]);
    // Imported customers share a created time, so the id breaks ties and pages never overlap.
    expect(orderBy(rowsCall())).toBe('"customers"."created_at" desc, "customers"."id" desc');
  });

  it("shows the last page for a page past the end", async () => {
    customersInDb(240);
    expect(await listCustomers({ page: 7 })).toMatchObject({ page: 3, from: 201, to: 240 });
  });

  it("never lists archived customers", async () => {
    customersInDb(3);
    await listCustomers({});
    expect(where(rowsCall()).sql).toBe('"customers"."archived_at" is null');
    expect(where(countCall()).sql).toBe('"customers"."archived_at" is null');
  });
});

describe("listCustomers search and filter", () => {
  it("matches addresses, contacts and phone numbers the same way as the search box", async () => {
    customersInDb(1);
    await listCustomers({ q: "Example Rd" });
    const list = where(rowsCall());
    expect(list.sql).toContain(render(customerMatches(parseSearchQuery("Example Rd")!)!).sql);
    expect(list.sql).toContain('"properties"."street" ilike');
    expect(list.sql).toContain('"properties"."postal_code" ilike');
    expect(list.sql).toContain('"contacts"."email" ilike');
    expect(list.params).toEqual(expect.arrayContaining(["%Example%", "%Rd%"]));
    // The total counts the same customers.
    expect(where(countCall())).toEqual(list);
  });

  it("finds a phone number however it's typed", async () => {
    customersInDb(1);
    await listCustomers({ q: "(604) 555-0142" });
    expect(where(rowsCall()).params).toContain("%6045550142%");
  });

  it("still filters on a one-letter search", async () => {
    customersInDb(1);
    await listCustomers({ q: " J " });
    expect(where(rowsCall()).params).toContain("%J%");
  });

  it("filters by type and keeps the search", async () => {
    customersInDb(1);
    await listCustomers({ q: "surrey", type: "strata" });
    expect(where(rowsCall()).params).toEqual(expect.arrayContaining(["strata", "%surrey%"]));
    expect(where(countCall()).params).toEqual(expect.arrayContaining(["strata", "%surrey%"]));
  });
});

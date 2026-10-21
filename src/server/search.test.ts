import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
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

const { globalSearch, searchKindsFor, canSearch } = await import("./search");

const dialect = new PgDialect({ casing: "snake_case" });
const where = (c: FakeCall) => dialect.sqlToQuery(c.args.where[0] as SQL);
const selectOn = (table: string) => h.fake.find("select", table)[0];

const OWNER = { role: "owner" };
const ESTIMATOR = { role: "estimator" };
const PAINTER = { role: "painter" };

beforeEach(() => h.fake.reset());

describe("who can search what", () => {
  it("office roles see what their permissions allow; field roles nothing", () => {
    expect(searchKindsFor("owner")).toEqual(["customer", "job", "estimate", "lead", "work_order"]);
    expect(searchKindsFor("estimator")).toEqual(["customer", "estimate", "lead"]);
    expect(searchKindsFor("project_manager")).toEqual(["customer", "job", "estimate", "lead", "work_order"]);
    for (const role of ["painter", "subcontractor", "crew_leader"]) {
      expect(searchKindsFor(role)).toEqual([]);
      expect(canSearch(role)).toBe(false);
    }
  });

  it("never queries anything for a field role", async () => {
    expect(await globalSearch(PAINTER, "jordan")).toEqual({ query: "jordan", groups: [] });
    expect(h.fake.calls).toEqual([]);
  });

  it("an estimator's search never touches sold jobs or work orders", async () => {
    await globalSearch(ESTIMATOR, "jordan");
    expect(h.fake.calls.map((c) => c.table).sort()).toEqual(["customers", "estimates", "opportunities"]);
  });

  it("ignores one-letter searches", async () => {
    expect((await globalSearch(OWNER, "j")).groups).toEqual([]);
    expect(h.fake.calls).toEqual([]);
  });
});

describe("results", () => {
  it("groups hits in a fixed order and shows no money", async () => {
    h.fake.queue({
      "select:customers": [[{ id: "c1", name: "Jordan Sample", type: "residential", email: "jordan@example.com", phone: "604-555-0142", address: "1234 Example Rd, Surrey" }]],
      "select:projects": [[{ id: "p1", number: 3101, name: "Jordan Sample – Exterior repaint", status: "scheduled", street: "1234 Example Rd", city: "Surrey" }]],
      "select:estimates": [[{ id: "e1", number: 5012, title: "Deck stain", status: "sent", customer: "Jordan Sample", city: "Surrey" }]],
      "select:opportunities": [[{ id: "l1", title: "Fence", customer: "Jordan Sample", stage: "Contacted", kind: "open", city: "Surrey" }]],
    });
    const r = await globalSearch(OWNER, "jordan");
    expect(r.groups.map((g) => g.label)).toEqual(["Customers", "Sold jobs", "Estimates", "Leads"]);
    expect(r.groups[0].hits[0]).toEqual({
      kind: "customer",
      id: "c1",
      title: "Jordan Sample",
      detail: "1234 Example Rd, Surrey · 604-555-0142",
      status: null,
      href: "/customers/c1",
    });
    expect(r.groups[1].hits[0]).toMatchObject({ title: "#3101 Jordan Sample – Exterior repaint", detail: "1234 Example Rd, Surrey", status: { label: "Scheduled" }, href: "/projects/p1" });
    expect(r.groups[2].hits[0]).toMatchObject({ title: "Jordan Sample", detail: "Deck stain · EST-5012 · Surrey", status: { label: "Sent", tone: "info" }, href: "/estimates/e1" });
    expect(r.groups[3].hits[0]).toMatchObject({ detail: "Fence · Surrey", status: { label: "Contacted" }, href: "/leads/l1" });
    expect(JSON.stringify(r)).not.toContain("$");
  });

  it("shows five per group and says when there are more", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: `Sample ${i}`, type: "strata", email: null, phone: null, address: null }));
    h.fake.queue({ "select:customers": [rows] });
    const [g] = (await globalSearch(OWNER, "sample")).groups;
    expect(g.hits).toHaveLength(5);
    expect(g.more).toBe(true);
    expect(g.hits[0].status).toEqual({ label: "Strata", tone: "info" });
    expect(selectOn("customers").args.limit).toEqual([6]);
  });

  it("puts the matching kind first for a number", async () => {
    h.fake.otherwise((c) => (c.table === "customers" ? [{ id: "c1", name: "A", type: "residential", email: null, phone: null, address: null }] : c.table === "work_orders" ? [{ id: "w1", number: 7001, title: "Job", status: "issued", projectId: "p1", projectNumber: 3101 }] : []));
    const r = await globalSearch(OWNER, "WO-7001");
    expect(r.groups.map((g) => g.kind)).toEqual(["work_order", "customer"]);
    expect(r.groups[0].hits[0]).toMatchObject({ title: "WO-7001 Job", detail: "Job #3101", href: "/projects/p1#work-orders" });
  });
});

describe("the SQL it builds", () => {
  it("matches every word against names and addresses, case-insensitively", async () => {
    await globalSearch(OWNER, "jordan surrey");
    const q = where(selectOn("customers"));
    expect(q.sql).toContain('"customers"."display_name" ilike');
    expect(q.sql).toContain('"properties"."street" ilike');
    expect(q.sql).toMatch(/\) and \(/); // both words must match
    expect(q.params).toEqual(expect.arrayContaining(["%jordan%", "%surrey%"]));
  });

  it("treats % and _ in the search as plain characters", async () => {
    await globalSearch(OWNER, "50%_off");
    expect(where(selectOn("customers")).params).toContain("%50\\%\\_off%");
  });

  it("compares phone numbers by their digits", async () => {
    await globalSearch(OWNER, "(604) 555-0142");
    const q = where(selectOn("customers"));
    expect(q.sql).toContain("regexp_replace");
    expect(q.params).toContain("%6045550142%");
  });

  it("looks up an explicit job number exactly", async () => {
    await globalSearch(OWNER, "#3033");
    const q = where(selectOn("projects"));
    expect(q.sql).toBe('"projects"."number" = $1');
    expect(q.params).toEqual([3033]);
  });

  it("hides signed estimates and won leads from people who can see the sold job", async () => {
    await globalSearch(OWNER, "jordan");
    expect(where(selectOn("estimates")).params).toEqual(expect.arrayContaining(["archived", "accepted"]));
    expect(where(selectOn("opportunities")).params).toContain("won");

    h.fake.reset();
    await globalSearch(ESTIMATOR, "jordan");
    expect(where(selectOn("estimates")).params).not.toContain("accepted");
    expect(where(selectOn("opportunities")).params).not.toContain("won");
  });

  it("still finds a signed estimate by its number", async () => {
    await globalSearch(OWNER, "EST-5012");
    const q = where(selectOn("estimates"));
    expect(q.params).toContain(5012);
    expect(q.params).not.toContain("accepted");
  });
});

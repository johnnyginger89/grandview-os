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

const { CrewError, saveCrew, setCrewActive, setCrewMembers, toCrewDTO } = await import("./crews");

const C = "00000000-0000-4000-8000-000000000010";
const ACTOR = { id: "owner-1" };
const crew = { name: "[TEST DATA] Niko", kind: "in_house", trade: "painting", color: "emerald", crewSize: 3, hoursPerDay: "8", worksSaturdays: false };

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
});

describe("crews", () => {
  it("refuses a duplicate name (case-insensitive check in the database)", async () => {
    h.fake.queue({ "select:crews": [[{ id: "other" }]] });
    await expect(saveCrew(crew, ACTOR)).rejects.toThrow("A crew with that name already exists.");
    expect(h.fake.find("insert", "crews")).toEqual([]);
  });

  it("adds a new crew at the end of the list and audits it", async () => {
    h.fake.queue({ "select:crews": [[], [{ next: 4 }]], "insert:crews": [[{ id: C }]] });
    expect(await saveCrew({ ...crew, subCompany: "", notes: "  " }, ACTOR)).toEqual({ id: C });
    expect(h.fake.find("insert", "crews")[0].args.values[0]).toMatchObject({ name: "[TEST DATA] Niko", sortOrder: 4, subCompany: null, notes: null, createdBy: "owner-1" });
    expect(h.audits.map((a) => a.action)).toEqual(["schedule.crew.save"]);
  });

  it("turns a unique-index race into the same friendly message", async () => {
    h.fake.queue({ "select:crews": [[], [{ next: 0 }]] });
    h.fake.otherwise((c) => {
      if (c.op === "insert") throw Object.assign(new Error("duplicate key"), { code: "23505" });
      return [];
    });
    await expect(saveCrew(crew, ACTOR)).rejects.toBeInstanceOf(CrewError);
  });

  it("won't deactivate a crew with upcoming bookings", async () => {
    h.fake.queue({ "select:crews": [[{ id: C, active: true }]], "select:schedule_entries": [[{ n: 3 }]] });
    await expect(setCrewActive({ id: C, active: false }, ACTOR)).rejects.toThrow("Move its 3 upcoming bookings first.");
    expect(h.fake.find("update", "crews")).toEqual([]);
  });

  it("only adds active users as members and audits the access change", async () => {
    h.fake.queue({ "select:crews": [[{ id: C }]], "select:user": [[{ id: "u1", active: true }, { id: "u2", active: false }]] });
    await expect(setCrewMembers({ crewId: C, members: [{ userId: "u1", isLead: true }, { userId: "u2", isLead: false }] }, ACTOR)).rejects.toThrow(/active users/);

    h.fake.reset();
    h.fake.queue({ "select:crews": [[{ id: C }]], "select:user": [[{ id: "u1", active: true }]], "select:crew_members": [[{ userId: "old", isLead: true }]] });
    await setCrewMembers({ crewId: C, members: [{ userId: "u1", isLead: true }] }, ACTOR);
    expect(h.fake.find("delete", "crew_members")).toHaveLength(1);
    expect(h.fake.find("insert", "crew_members")[0].args.values[0]).toEqual([{ crewId: C, userId: "u1", isLead: true, addedBy: "owner-1" }]);
    expect(h.audits).toEqual([expect.objectContaining({ action: "schedule.crew.members", before: [{ userId: "old", isLead: true }], after: [{ userId: "u1", isLead: true }] })]);
  });

  it("builds the crew DTO field by field", () => {
    const dto = toCrewDTO({ ...crew, id: C, kind: "in_house", trade: "painting", color: "emerald", subCompany: null, hoursPerDay: "8.00", active: true, sortOrder: 0, memberCount: "2", notes: "x" } as never);
    expect(Object.keys(dto).sort()).toEqual(["active", "color", "crewSize", "hoursPerDay", "id", "kind", "memberCount", "name", "sortOrder", "subCompany", "trade", "worksSaturdays"]);
    expect(dto.memberCount).toBe(2);
  });
});

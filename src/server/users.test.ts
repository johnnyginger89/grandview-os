import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

type Entry = { actorId: string | null; action: string; entityId?: string | null; ipAddress?: string | null; after?: unknown };

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  target: null as null | { id: string; name: string; email: string; twoFactorEnabled: boolean | null },
  audits: [] as Entry[],
  created: [] as Record<string, unknown>[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  h.fake.db.query = { user: { findFirst: async () => h.target } };
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: Entry) => void h.audits.push(e) }));
vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({
      password: { hash: async (p: string) => `hashed:${p}` },
      internalAdapter: {
        createUser: async (data: Record<string, unknown>) => (h.created.push(data), { id: "new-1", ...data }),
        linkAccount: async () => undefined,
      },
    }),
  },
}));

const { createUserAccount, resetTwoFactor, setTemporaryPassword } = await import("./users");
const OWNER = { id: "owner-1", role: "owner" };
const META = { ip: "192.0.2.44", userAgent: "owner-phone" };
const dialect = new PgDialect({ casing: "snake_case" });
const writes = () => h.fake.calls.filter((c) => c.op !== "select");
const passwordWrites = () => h.fake.find("update", "account").map((c) => (c.args.set?.[0] as { password: string }).password);

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.created = [];
  h.target = { id: "painter-1", name: "Pat Painter", email: "pat@example.com", twoFactorEnabled: true };
  h.fake.otherwise((call: FakeCall) => (call.op === "update" && call.table === "account" ? [{ id: "account-1" }] : []));
});

describe("owner resets for someone else's sign-in", () => {
  for (const [what, run] of [
    ["temporary password", (actor: { id: string; role: string }, id = "painter-1") => setTemporaryPassword(id, actor, META)],
    ["two-step reset", (actor: { id: string; role: string }, id = "painter-1") => resetTwoFactor(id, actor, META)],
  ] as const) {
    it(`${what}: refused for anyone but the owner, including administrators`, async () => {
      for (const role of ["admin", "operations_manager", "estimator", "painter"]) {
        await expect(run({ id: "someone", role })).rejects.toThrow(/Only the owner can reset/);
      }
      expect(writes()).toEqual([]);
      expect(h.audits).toEqual([]);
    });

    it(`${what}: refused for the owner's own account`, async () => {
      h.target = { id: "owner-1", name: "Olive Owner", email: "olive@example.com", twoFactorEnabled: true };
      await expect(run(OWNER, "owner-1")).rejects.toThrow(/Use Password & security/);
      expect(writes()).toEqual([]);
    });

    it(`${what}: refused for someone who doesn't exist`, async () => {
      h.target = null;
      await expect(run(OWNER, "ghost")).rejects.toThrow(/User not found/);
      expect(writes()).toEqual([]);
    });
  }

  it("sets a temporary password that must be changed, signs them out everywhere and records it without the password", async () => {
    const r = await setTemporaryPassword("painter-1", OWNER, META);
    expect(r).toMatchObject({ name: "Pat Painter", email: "pat@example.com" });
    expect(r.tempPassword).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(passwordWrites()).toEqual([`hashed:${r.tempPassword}`]);
    expect(h.fake.find("update", "user")[0].args.set?.[0]).toMatchObject({ mustChangePassword: true });
    // Every session of theirs, none kept.
    expect(dialect.sqlToQuery(h.fake.find("delete", "session")[0].args.where[0] as SQL)).toMatchObject({ sql: '"session"."user_id" = $1', params: ["painter-1"] });
    expect(h.audits).toEqual([{ actorId: "owner-1", action: "user.temporary_password", entityType: "user", entityId: "painter-1", ipAddress: "192.0.2.44", after: { userAgent: "owner-phone" } }]);
    expect(JSON.stringify(h.audits)).not.toContain(r.tempPassword);
  });

  it("each reset makes a different temporary password", async () => {
    const a = await setTemporaryPassword("painter-1", OWNER, META);
    const b = await setTemporaryPassword("painter-1", OWNER, META);
    expect(a.tempPassword).not.toBe(b.tempPassword);
  });

  it("resets two-step: removes the authenticator, turns it off, forgets trusted devices and signs them out", async () => {
    expect(await resetTwoFactor("painter-1", OWNER, META)).toEqual({ name: "Pat Painter" });
    expect(dialect.sqlToQuery(h.fake.find("delete", "two_factor")[0].args.where[0] as SQL).params).toEqual(["painter-1"]);
    expect(h.fake.find("update", "user")[0].args.set?.[0]).toMatchObject({ twoFactorEnabled: false });
    expect(dialect.sqlToQuery(h.fake.find("delete", "verification")[0].args.where[0] as SQL)).toMatchObject({
      sql: '("verification"."value" = $1 and "verification"."identifier" like $2)',
      params: ["painter-1", "trust-device-%"],
    });
    expect(h.fake.find("delete", "session")).toHaveLength(1);
    expect(passwordWrites()).toEqual([]);
    expect(h.audits).toEqual([{ actorId: "owner-1", action: "user.two_factor_reset", entityType: "user", entityId: "painter-1", ipAddress: "192.0.2.44", after: { userAgent: "owner-phone" } }]);
  });

  it("says so when two-step isn't on", async () => {
    h.target = { id: "painter-1", name: "Pat Painter", email: "pat@example.com", twoFactorEnabled: false };
    await expect(resetTwoFactor("painter-1", OWNER, META)).rejects.toThrow(/isn't on for Pat Painter/);
    expect(writes()).toEqual([]);
  });

  it("other owners' logins can be reset by an owner", async () => {
    h.target = { id: "owner-2", name: "Second Owner", email: "second@example.com", twoFactorEnabled: true };
    await expect(setTemporaryPassword("owner-2", OWNER, META)).resolves.toMatchObject({ name: "Second Owner" });
  });
});

describe("new logins", () => {
  it("must replace the temporary password at their first sign-in", async () => {
    h.target = null;
    const r = await createUserAccount({ name: "[TEST DATA] New Painter", email: "new@example.com", role: "painter" }, "owner-1", "owner", META);
    expect(h.created).toEqual([expect.objectContaining({ email: "new@example.com", role: "painter", mustChangePassword: true })]);
    expect(r.tempPassword).toHaveLength(16);
    expect(h.audits).toEqual([expect.objectContaining({ action: "user.create", ipAddress: "192.0.2.44" })]);
  });
});

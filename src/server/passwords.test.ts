import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

type Entry = { actorId: string | null; action: string; ipAddress?: string | null; after?: unknown };

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb, audits: [] as Entry[], flagWasSet: true, hasCredential: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: Entry) => void h.audits.push(e) }));
vi.mock("@/lib/auth", () => ({ auth: { $context: Promise.resolve({ password: { hash: async (p: string) => `hashed:${p}` } }) } }));

const { passwordChosenBySelf, temporaryPassword, writePassword } = await import("./passwords");
const dialect = new PgDialect({ casing: "snake_case" });
const META = { ip: "198.51.100.1", userAgent: "browser" };

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.flagWasSet = true;
  h.hasCredential = true;
  h.fake.otherwise((call: FakeCall) => {
    if (call.op === "update" && call.table === "user") return h.flagWasSet ? [{ id: "u1" }] : [];
    if (call.op === "update" && call.table === "account") return h.hasCredential ? [{ id: "account-1" }] : [];
    return [];
  });
});

describe("choosing your own password", () => {
  it("ends a temporary password and records it with where it came from", async () => {
    await passwordChosenBySelf("u1", "changed", META);
    const update = h.fake.find("update", "user")[0];
    expect(update.args.set?.[0]).toMatchObject({ mustChangePassword: false });
    expect(dialect.sqlToQuery(update.args.where[0] as SQL)).toMatchObject({ sql: '("user"."id" = $1 and "user"."must_change_password" = $2)', params: ["u1", true] });
    expect(h.audits).toEqual([{ actorId: "u1", action: "account.password_changed", entityType: "user", entityId: "u1", ipAddress: "198.51.100.1", after: { userAgent: "browser", replacedTemporaryPassword: true } }]);
  });

  it("records an ordinary change or an emailed reset too", async () => {
    h.flagWasSet = false;
    await passwordChosenBySelf("u1", "reset_link", META);
    expect(h.audits).toEqual([expect.objectContaining({ action: "account.password_reset_by_link", after: { userAgent: "browser", replacedTemporaryPassword: false } })]);
  });
});

describe("writing a password", () => {
  const tx = () => h.fake.db;

  it("hashes it, marks whether it must be changed and ends sessions except the one kept", async () => {
    await writePassword(tx(), "u1", "a-new-password-12", { mustChange: false, keepSessionId: "s-keep" });
    expect(h.fake.find("update", "account")[0].args.set?.[0]).toMatchObject({ password: "hashed:a-new-password-12" });
    expect(h.fake.find("update", "user")[0].args.set?.[0]).toMatchObject({ mustChangePassword: false });
    expect(dialect.sqlToQuery(h.fake.find("delete", "session")[0].args.where[0] as SQL)).toMatchObject({ sql: '("session"."user_id" = $1 and "session"."id" <> $2)', params: ["u1", "s-keep"] });
  });

  it("refuses an account that has no password sign-in, before touching anything else", async () => {
    h.hasCredential = false;
    await expect(writePassword(tx(), "u1", "a-new-password-12", { mustChange: true })).rejects.toThrow(/doesn't sign in with a password/);
    expect(h.fake.find("update", "user")).toEqual([]);
    expect(h.fake.find("delete", "session")).toEqual([]);
  });

  it("makes 16-character temporary passwords that differ every time", () => {
    const all = new Set(Array.from({ length: 50 }, temporaryPassword));
    expect(all.size).toBe(50);
    for (const p of all) expect(p).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});

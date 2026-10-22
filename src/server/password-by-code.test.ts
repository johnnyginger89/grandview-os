import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

type Entry = { actorId: string | null; action: string; ipAddress?: string | null };

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as Entry[],
  session: null as null | { user: { id: string; twoFactorEnabled: boolean; mustChangePassword?: boolean }; session: { id: string } },
  codeOk: true,
  totpCalls: 0,
  locked: true,
  failures: 0,
  currentPassword: "the-temporary-one",
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: Entry) => void h.audits.push(e) }));
vi.mock("./request-meta", () => ({ requestMeta: () => ({ ip: "198.51.100.7", userAgent: "test-browser" }) }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => h.session,
      verifyTOTP: async ({ body }: { body: { code: string } }) => {
        h.totpCalls++;
        if (!h.codeOk || body.code !== "123456") throw new Error("INVALID_CODE");
        return { status: true };
      },
    },
    $context: Promise.resolve({
      password: { hash: async (p: string) => `hashed:${p}`, verify: async ({ hash, password }: { hash: string; password: string }) => hash === `hashed:${password}` },
    }),
  },
}));

const { setPasswordWithCode } = await import("./password-by-code");
const H = new Headers();
const passwordWrites = () => h.fake.find("update", "account").map((c) => (c.args.set?.[0] as { password: string }).password);

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.codeOk = true;
  h.totpCalls = 0;
  h.locked = true;
  h.failures = 0;
  h.session = { user: { id: "owner-1", twoFactorEnabled: true }, session: { id: "s1" } };
  h.fake.otherwise((call: FakeCall) => {
    if (call.op === "execute") return { rows: [{ locked: h.locked }] };
    if (call.op === "select" && call.table === "audit_log") return [{ n: h.failures }];
    if (call.op === "select" && call.table === "account") return [{ hash: `hashed:${h.currentPassword}` }];
    if (call.op === "update" && call.table === "account") return [{ id: "account-1" }];
    return [];
  });
});

describe("setting a new password with the authenticator code", () => {
  it("sets it and signs out other devices when the code is right", async () => {
    await setPasswordWithCode({ code: "123456", newPassword: "a-brand-new-password" }, H);
    expect(passwordWrites()).toEqual(["hashed:a-brand-new-password"]);
    expect(h.fake.find("delete", "session")).toHaveLength(1);
    expect(h.fake.find("update", "user")[0].args.set?.[0]).toMatchObject({ mustChangePassword: false });
    expect(h.audits).toEqual([expect.objectContaining({ action: "account.password_set_with_code", ipAddress: "198.51.100.7" })]);
  });

  it("refuses a wrong code and counts it, with the IP", async () => {
    await expect(setPasswordWithCode({ code: "000000", newPassword: "a-brand-new-password" }, H)).rejects.toThrow(/didn't match/);
    expect(passwordWrites()).toEqual([]);
    expect(h.audits).toEqual([expect.objectContaining({ actorId: "owner-1", action: "account.password_code_failed", ipAddress: "198.51.100.7" })]);
  });

  it("stops after 5 wrong codes in 15 minutes, even with the right one", async () => {
    h.failures = 5;
    await expect(setPasswordWithCode({ code: "123456", newPassword: "a-brand-new-password" }, H)).rejects.toThrow(/Too many wrong codes/);
    expect(h.totpCalls).toBe(0);
    expect(passwordWrites()).toEqual([]);
  });

  it("doesn't check a code while another one for the same person is being checked", async () => {
    h.locked = false;
    await expect(setPasswordWithCode({ code: "123456", newPassword: "a-brand-new-password" }, H)).rejects.toThrow(/Still checking/);
    expect(h.totpCalls).toBe(0);
    expect(h.audits).toEqual([]);
  });

  it("needs a signed-in user with two-factor on", async () => {
    h.session = null;
    await expect(setPasswordWithCode({ code: "123456", newPassword: "a-brand-new-password" }, H)).rejects.toThrow(/sign in/);
    h.session = { user: { id: "u2", twoFactorEnabled: false }, session: { id: "s2" } };
    await expect(setPasswordWithCode({ code: "123456", newPassword: "a-brand-new-password" }, H)).rejects.toThrow(/current password/);
    expect(passwordWrites()).toEqual([]);
  });

  it("won't keep a temporary password: it has to be a new one", async () => {
    h.session = { user: { id: "u3", twoFactorEnabled: true, mustChangePassword: true }, session: { id: "s3" } };
    await expect(setPasswordWithCode({ code: "123456", newPassword: "the-temporary-one" }, H)).rejects.toThrow(/different from your current one/);
    expect(passwordWrites()).toEqual([]);
    await setPasswordWithCode({ code: "123456", newPassword: "my-own-password-now" }, H);
    expect(passwordWrites()).toEqual(["hashed:my-own-password-now"]);
    expect(h.fake.find("update", "user")[0].args.set?.[0]).toMatchObject({ mustChangePassword: false });
  });
});

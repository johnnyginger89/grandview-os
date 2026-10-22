import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as { action: string }[],
  session: null as null | { user: { id: string; twoFactorEnabled: boolean }; session: { id: string } },
  codeOk: true,
  failures: 0,
  updated: [] as [string, string][],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: { action: string }) => void h.audits.push(e) }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => h.session,
      verifyTOTP: async ({ body }: { body: { code: string } }) => {
        if (!h.codeOk || body.code !== "123456") throw new Error("INVALID_CODE");
        return { status: true };
      },
    },
    $context: Promise.resolve({
      password: { hash: async (p: string) => `hashed:${p}` },
      internalAdapter: { updatePassword: async (id: string, hash: string) => void h.updated.push([id, hash]) },
    }),
  },
}));

const { setPasswordWithCode } = await import("./password-by-code");
const H = new Headers();

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.updated = [];
  h.codeOk = true;
  h.failures = 0;
  h.session = { user: { id: "owner-1", twoFactorEnabled: true }, session: { id: "s1" } };
  h.fake.otherwise((call) => (call.op === "select" ? [{ n: h.failures }] : []));
});

describe("setting a new password with the authenticator code", () => {
  it("sets it and signs out other devices when the code is right", async () => {
    await setPasswordWithCode({ code: "123456", newPassword: "a-brand-new-password" }, H);
    expect(h.updated).toEqual([["owner-1", "hashed:a-brand-new-password"]]);
    expect(h.fake.find("delete", "session")).toHaveLength(1);
    expect(h.audits.map((a) => a.action)).toEqual(["account.password_set_with_code"]);
  });

  it("refuses a wrong code and counts it", async () => {
    await expect(setPasswordWithCode({ code: "000000", newPassword: "a-brand-new-password" }, H)).rejects.toThrow(/didn't match/);
    expect(h.updated).toEqual([]);
    expect(h.audits.map((a) => a.action)).toEqual(["account.password_code_failed"]);
  });

  it("stops after 5 wrong codes in 15 minutes, even with the right one", async () => {
    h.failures = 5;
    await expect(setPasswordWithCode({ code: "123456", newPassword: "a-brand-new-password" }, H)).rejects.toThrow(/Too many wrong codes/);
    expect(h.updated).toEqual([]);
  });

  it("needs a signed-in user with two-factor on", async () => {
    h.session = null;
    await expect(setPasswordWithCode({ code: "123456", newPassword: "a-brand-new-password" }, H)).rejects.toThrow(/sign in/);
    h.session = { user: { id: "u2", twoFactorEnabled: false }, session: { id: "s2" } };
    await expect(setPasswordWithCode({ code: "123456", newPassword: "a-brand-new-password" }, H)).rejects.toThrow(/current password/);
    expect(h.updated).toEqual([]);
  });
});

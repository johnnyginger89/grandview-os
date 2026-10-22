import { symmetricDecrypt } from "better-auth/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

type Entry = { actorId: string | null; action: string; ipAddress?: string | null; after?: unknown };
const SECRET = "test-secret-that-is-long-enough-1234";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as Entry[],
  session: null as null | { user: { id: string; twoFactorEnabled: boolean }; session: { id: string } },
  totpCalls: 0,
  locked: true,
  failures: 0,
  hasTwoFactorRow: true,
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
        if (body.code !== "123456") throw new Error("INVALID_CODE");
        return { status: true };
      },
    },
    $context: Promise.resolve({ secretConfig: "test-secret-that-is-long-enough-1234" }),
  },
}));

const { newBackupCodes, regenerateBackupCodes } = await import("./backup-codes");
const H = new Headers();
const stored = () => h.fake.find("update", "two_factor").map((c) => (c.args.set?.[0] as { backupCodes: string }).backupCodes);

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.totpCalls = 0;
  h.locked = true;
  h.failures = 0;
  h.hasTwoFactorRow = true;
  h.session = { user: { id: "u1", twoFactorEnabled: true }, session: { id: "s1" } };
  h.fake.otherwise((call: FakeCall) => {
    if (call.op === "execute") return { rows: [{ locked: h.locked }] };
    if (call.op === "select" && call.table === "audit_log") return [{ n: h.failures }];
    if (call.op === "update" && call.table === "two_factor") return h.hasTwoFactorRow ? [{ id: "tf-1" }] : [];
    return [];
  });
});

describe("new backup codes", () => {
  it("look like Better Auth's own: 10 different codes of 5+5 letters and digits", () => {
    const codes = newBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);
  });

  it("replace the old set, stored encrypted the way sign-in reads them, and are recorded without the codes", async () => {
    const codes = await regenerateBackupCodes({ code: "123456" }, H);
    expect(codes).toHaveLength(10);
    const [saved] = stored();
    expect(saved).not.toContain(codes[0]);
    expect(JSON.parse(await symmetricDecrypt({ key: SECRET, data: saved }))).toEqual(codes);
    expect(h.audits).toEqual([{ actorId: "u1", action: "account.backup_codes_regenerated", entityType: "user", entityId: "u1", ipAddress: "198.51.100.7", after: { userAgent: "test-browser" } }]);
    expect(JSON.stringify(h.audits)).not.toContain(codes[0]);
  });

  it("need the right authenticator code, and count wrong ones", async () => {
    await expect(regenerateBackupCodes({ code: "000000" }, H)).rejects.toThrow(/didn't match/);
    expect(stored()).toEqual([]);
    expect(h.audits).toEqual([expect.objectContaining({ actorId: "u1", action: "account.backup_codes_code_failed", ipAddress: "198.51.100.7" })]);
  });

  it("stop after 5 wrong codes (shared with setting a password by code), even with the right one", async () => {
    h.failures = 5;
    await expect(regenerateBackupCodes({ code: "123456" }, H)).rejects.toThrow(/Too many wrong codes/);
    expect(h.totpCalls).toBe(0);
    expect(stored()).toEqual([]);
  });

  it("need a signed-in person with two-factor on", async () => {
    h.session = null;
    await expect(regenerateBackupCodes({ code: "123456" }, H)).rejects.toThrow(/sign in/);
    h.session = { user: { id: "u2", twoFactorEnabled: false }, session: { id: "s2" } };
    await expect(regenerateBackupCodes({ code: "123456" }, H)).rejects.toThrow(/Turn on two-factor/);
    h.session = { user: { id: "u3", twoFactorEnabled: true }, session: { id: "s3" } };
    h.hasTwoFactorRow = false;
    await expect(regenerateBackupCodes({ code: "123456" }, H)).rejects.toThrow(/isn't set up/);
    expect(h.audits).toEqual([]);
  });
});

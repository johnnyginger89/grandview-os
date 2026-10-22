import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

type Entry = { actorId: string | null; action: string; entityType: string; entityId?: string | null; ipAddress?: string | null; after?: Record<string, unknown> };

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  locked: true,
  failures: 0,
  used: false,
  owner: null as null | { id: string; email: string },
  owners: [] as { id: string }[],
  audits: [] as Entry[],
  notices: [] as { to: string[]; title: string; body: string | null }[],
  emails: [] as { to: string; subject: string; text: string }[],
  later: [] as Promise<void>[],
  notifyFails: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  h.fake.db.query = { user: { findFirst: async () => h.owner } };
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: Entry) => void h.audits.push(e) }));
vi.mock("./notifications", () => ({
  notify: async (to: string[], n: { title: string; body?: string | null }) => {
    if (h.notifyFails) throw new Error("push service down");
    h.notices.push({ to: [...new Set(to)], title: n.title, body: n.body ?? null });
  },
  notifyLater: (task: () => Promise<void>) => void h.later.push(task()),
}));
vi.mock("@/lib/email", () => ({ sendEmail: async (m: { to: string; subject: string; text: string }) => (h.emails.push(m), { status: "logged", provider: "test" }) }));
vi.mock("@/lib/auth", () => ({ auth: { $context: Promise.resolve({ password: { hash: async (p: string) => `hashed:${p}` } }) } }));

const CODE = "a long recovery sentence typed in vercel 2026";
const META = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (test)" };
const NOW = new Date("2026-10-22T17:30:00Z");
const { codeFingerprint, recoverOwner, recoveryConfigured } = await import("./owner-recovery");
const input = (o: Partial<{ code: string; email: string; password: string; confirm: string }> = {}) => ({ code: CODE, email: " Info@Example.com ", password: "brand-new-password-1", confirm: "brand-new-password-1", ...o });
const recover = (o: Parameters<typeof input>[0] = {}) => recoverOwner(input(o), META, NOW);
const passwordWrites = () => h.fake.find("update", "account").map((c) => (c.args.set?.[0] as { password: string }).password);
const actions = () => h.audits.map((a) => a.action);
/** Everything written to the database (values and updates), as text. */
const written = () => JSON.stringify(h.fake.calls.map((c) => [c.args.values, c.args.set]));

beforeEach(() => {
  process.env.OWNER_RECOVERY_CODE = CODE;
  h.fake.reset();
  h.locked = true;
  h.failures = 0;
  h.used = false;
  h.owner = { id: "owner-1", email: "info@example.com" };
  h.owners = [{ id: "owner-1" }, { id: "owner-2" }];
  h.audits = [];
  h.notices = [];
  h.emails = [];
  h.later = [];
  h.notifyFails = false;
  h.fake.otherwise((call: FakeCall) => {
    if (call.op === "execute") return { rows: [{ locked: h.locked }] };
    if (call.op === "select" && call.table === "audit_log") return call.args.limit ? (h.used ? [{ id: "audit-1" }] : []) : [{ n: h.failures }];
    if (call.op === "select" && call.table === "user") return h.owners;
    if (call.op === "update" && call.table === "account") return [{ id: "account-1" }];
    return [];
  });
});

describe("owner recovery", () => {
  it("is off unless a long code is set in the hosting settings", async () => {
    delete process.env.OWNER_RECOVERY_CODE;
    expect(recoveryConfigured()).toBe(false);
    await expect(recover()).rejects.toThrow(/doesn't match/);
    process.env.OWNER_RECOVERY_CODE = "too-short";
    expect(recoveryConfigured()).toBe(false);
    await expect(recover({ code: "too-short" })).rejects.toThrow(/doesn't match/);
    expect(passwordWrites()).toEqual([]);
  });

  it("refuses the wrong code and records the try with the IP and browser, never the code", async () => {
    await expect(recover({ code: "a guess that is long enough to look real" })).rejects.toThrow(/doesn't match/);
    expect(passwordWrites()).toEqual([]);
    expect(h.audits).toEqual([
      { actorId: null, action: "account.owner_recovery_failed", entityType: "owner_recovery", ipAddress: "203.0.113.9", after: { reason: "wrong_code", userAgent: "Mozilla/5.0 (test)" } },
    ]);
    expect(written()).not.toContain("a guess");
  });

  it("after 5 wrong codes in an hour it refuses everyone, even with the right code", async () => {
    h.failures = 5;
    await expect(recover()).rejects.toThrow(/Too many wrong recovery codes in the last hour/);
    expect(passwordWrites()).toEqual([]);
    expect(h.audits).toEqual([]);
    h.failures = 4;
    await recover();
    expect(passwordWrites()).toEqual(["hashed:brand-new-password-1"]);
  });

  it("turns a try away unchecked while another one is being checked", async () => {
    h.locked = false;
    await expect(recover({ code: "wrong-wrong-wrong-wrong-wrong-wrong-1" })).rejects.toThrow(/being checked/);
    await expect(recover()).rejects.toThrow(/being checked/);
    expect(h.audits).toEqual([]);
    expect(passwordWrites()).toEqual([]);
  });

  it("sets the new password, signs out every device and keeps only a fingerprint of the code", async () => {
    await recover();
    expect(passwordWrites()).toEqual(["hashed:brand-new-password-1"]);
    expect(h.fake.find("delete", "session")).toHaveLength(1);
    expect(h.fake.find("update", "user")[0].args.set?.[0]).toMatchObject({ mustChangePassword: false });
    const fingerprint = await codeFingerprint(CODE);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(h.audits).toEqual([
      { actorId: "owner-1", action: "account.owner_recovered", entityType: "user", entityId: "owner-1", ipAddress: "203.0.113.9", after: { userAgent: "Mozilla/5.0 (test)", codeFingerprint: fingerprint } },
    ]);
    expect(JSON.stringify(h.audits)).not.toContain(CODE);
    expect(written()).not.toContain(CODE);
  });

  it("works once: the same code is refused after it was used, and counts as a wrong try", async () => {
    h.used = true;
    await expect(recover()).rejects.toThrow(/already been used\. Put a new one in Vercel/);
    expect(passwordWrites()).toEqual([]);
    expect(actions()).toEqual(["account.owner_recovery_failed"]);
    expect(h.audits[0].after).toMatchObject({ reason: "used_code" });
  });

  it("a new code in Vercel works again", async () => {
    expect(await codeFingerprint(CODE)).not.toBe(await codeFingerprint(`${CODE} (new)`));
    expect(await codeFingerprint(CODE)).toBe(await codeFingerprint(CODE));
  });

  it("only resets an owner account, without counting it as a wrong code", async () => {
    h.owner = null;
    await expect(recover()).rejects.toThrow(/No owner account/);
    expect(passwordWrites()).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("tells every owner in the app and emails the account, after the response", async () => {
    await recover();
    expect(h.notices).toEqual([{ to: ["owner-1", "owner-2"], title: "The password for info@example.com was reset on the recovery page", body: expect.stringContaining("from 203.0.113.9") }]);
    await Promise.all(h.later);
    expect(h.emails).toEqual([{ to: "info@example.com", subject: "Your Grandview OS password was reset with the recovery code", text: expect.stringContaining("203.0.113.9") }]);
    expect(h.emails[0].text).not.toContain(CODE);
    expect(h.emails[0].text).not.toContain("brand-new-password-1");
  });

  it("still succeeds when the notices can't be sent", async () => {
    h.notifyFails = true;
    await expect(recover()).resolves.toBeUndefined();
    expect(passwordWrites()).toEqual(["hashed:brand-new-password-1"]);
  });

  it("checks the passwords match", async () => {
    await expect(recover({ confirm: "something-else-123" })).rejects.toThrow();
    expect(passwordWrites()).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  owner: null as null | { id: string },
  updated: [] as [string, string][],
  deleted: 0,
  audits: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
  db: {
    query: { user: { findFirst: async () => h.owner } },
    delete: () => ({ where: async () => void h.deleted++ }),
  },
}));
vi.mock("./audit", () => ({ audit: async (e: { action: string }) => void h.audits.push(e.action) }));
vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({
      password: { hash: async (p: string) => `hashed:${p}` },
      internalAdapter: { updatePassword: async (id: string, hash: string) => void h.updated.push([id, hash]) },
    }),
  },
}));

const CODE = "a long recovery sentence typed in vercel 2026";
const { recoverOwner, recoveryConfigured } = await import("./owner-recovery");
const input = (o: Partial<{ code: string; email: string; password: string; confirm: string }> = {}) => ({ code: CODE, email: " Info@Example.com ", password: "brand-new-password-1", confirm: "brand-new-password-1", ...o });

beforeEach(() => {
  process.env.OWNER_RECOVERY_CODE = CODE;
  h.owner = { id: "owner-1" };
  h.updated = [];
  h.deleted = 0;
  h.audits = [];
});

describe("owner recovery", () => {
  it("is off unless a long code is set in the hosting settings", async () => {
    delete process.env.OWNER_RECOVERY_CODE;
    expect(recoveryConfigured()).toBe(false);
    await expect(recoverOwner(input())).rejects.toThrow(/doesn't match/);
    process.env.OWNER_RECOVERY_CODE = "too-short";
    expect(recoveryConfigured()).toBe(false);
    expect(h.updated).toEqual([]);
  });

  it("refuses the wrong code", async () => {
    await expect(recoverOwner(input({ code: "guess" }))).rejects.toThrow(/doesn't match/);
    expect(h.updated).toEqual([]);
  });

  it("only resets an owner account", async () => {
    h.owner = null;
    await expect(recoverOwner(input())).rejects.toThrow(/No owner account/);
    expect(h.updated).toEqual([]);
  });

  it("sets the new password and signs out every device", async () => {
    await recoverOwner(input());
    expect(h.updated).toEqual([["owner-1", "hashed:brand-new-password-1"]]);
    expect(h.deleted).toBe(1);
    expect(h.audits).toEqual(["account.owner_recovered"]);
  });

  it("checks the passwords match", async () => {
    await expect(recoverOwner(input({ confirm: "something-else-123" }))).rejects.toThrow();
    expect(h.updated).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionUser = { id: string; name: string; email: string; role: string; active?: boolean; twoFactorEnabled?: boolean; mustChangePassword?: boolean };

const h = vi.hoisted(() => ({ user: null as null | SessionUser }));
vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => (h.user ? { user: h.user, session: { id: "s1" } } : null) } } }));

const guard = await import("./guard");
const as = (role: string, extra: Partial<SessionUser> = {}): SessionUser => ({ id: `${role}-1`, name: role, email: `${role}@example.com`, role, twoFactorEnabled: true, mustChangePassword: false, ...extra });

beforeEach(() => {
  process.env.MFA_ENFORCED = "true";
  h.user = null;
});
afterEach(() => {
  delete process.env.MFA_ENFORCED;
});

describe("account setup comes before anything else", () => {
  it("a temporary password must be replaced first, for every role, whatever the two-step setting", async () => {
    process.env.MFA_ENFORCED = "false";
    for (const role of ["owner", "estimator", "painter", "subcontractor"]) {
      h.user = as(role, { mustChangePassword: true });
      await expect(guard.requireUser()).rejects.toThrow("REDIRECT /account/security?change=1");
      await expect(guard.requirePermission("projects.read_assigned")).rejects.toThrow("REDIRECT /account/security?change=1");
      await expect(guard.assertPermission("projects.read_assigned")).rejects.toThrow("Choose your own password first");
      const u = await guard.getCurrentUser();
      expect(u && guard.needsAccountSetup(u)).toBe(true);
    }
  });

  it("only Password & security opens while it's pending", async () => {
    h.user = as("estimator", { mustChangePassword: true });
    await expect(guard.requireUser({ allowSetupPending: true })).resolves.toMatchObject({ id: "estimator-1", mustChangePassword: true });
  });

  it("the password comes before two-step when both are pending", async () => {
    h.user = as("estimator", { mustChangePassword: true, twoFactorEnabled: false });
    await expect(guard.requireUser()).rejects.toThrow("REDIRECT /account/security?change=1");
    h.user = as("estimator", { twoFactorEnabled: false });
    await expect(guard.requireUser()).rejects.toThrow("REDIRECT /account/security?setup=1");
    await expect(guard.assertPermission("estimates.read")).rejects.toThrow("Set up two-factor authentication first.");
  });

  it("two-step is needed only by office roles, and only where it's enforced", async () => {
    h.user = as("painter", { twoFactorEnabled: false });
    await expect(guard.requireUser()).resolves.toMatchObject({ role: "painter" });
    process.env.MFA_ENFORCED = "false";
    h.user = as("estimator", { twoFactorEnabled: false });
    await expect(guard.requireUser()).resolves.toMatchObject({ role: "estimator" });
  });

  it("a set-up account gets in, still only to what its role allows", async () => {
    h.user = as("estimator");
    await expect(guard.requirePermission("estimates.read")).resolves.toMatchObject({ role: "estimator" });
    await expect(guard.requirePermission("users.manage")).rejects.toThrow("REDIRECT /no-access");
    await expect(guard.assertPermission("users.manage")).rejects.toThrow("You don't have permission");
  });

  it("signed out and deactivated people are treated alike", async () => {
    await expect(guard.requireUser()).rejects.toThrow("REDIRECT /login");
    h.user = as("owner", { active: false });
    await expect(guard.assertPermission("dashboard.view")).rejects.toThrow("session has expired");
  });
});

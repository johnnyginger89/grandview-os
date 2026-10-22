import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ chosen: [] as [string, string, unknown][], fails: false }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ status: "logged", provider: "test" }) }));
vi.mock("@/server/request-meta", () => ({ requestMeta: (headers: Headers) => ({ ip: headers.get("x-test-ip"), userAgent: null }) }));
vi.mock("@/server/passwords", () => ({
  passwordChosenBySelf: async (userId: string, how: string, meta: unknown) => {
    if (h.fails) throw new Error("database is down");
    h.chosen.push([userId, how, meta]);
  },
}));

const { auth } = await import("./auth");
const hooks = auth.options.hooks!;
const headers = new Headers({ "x-test-ip": "203.0.113.5" });
const call = (hook: typeof hooks.before, ctx: Record<string, unknown>) => hook!({ headers, context: {}, ...ctx } as never);

beforeEach(() => {
  h.chosen = [];
  h.fails = false;
});

describe("changing your own password through Better Auth", () => {
  it("refuses keeping the same password (a temporary one would stay the one the owner knows)", async () => {
    await expect(call(hooks.before, { path: "/change-password", body: { currentPassword: "the-temporary-one", newPassword: "the-temporary-one" } })).rejects.toMatchObject({
      body: { code: "PASSWORD_UNCHANGED", message: "Choose a new password, different from your current one." },
    });
    await expect(call(hooks.before, { path: "/change-password", body: { currentPassword: "the-temporary-one", newPassword: "my-own-password-1" } })).resolves.toBeUndefined();
    await expect(call(hooks.before, { path: "/sign-in/email", body: { email: "a@example.com", password: "x" } })).resolves.toBeUndefined();
  });

  it("ends a temporary password once the change has gone through", async () => {
    await call(hooks.after, { path: "/change-password", context: { returned: { token: "t", user: { id: "u1" } } } });
    expect(h.chosen).toEqual([["u1", "changed", { ip: "203.0.113.5", userAgent: null }]]);
  });

  it("does nothing when the change was refused, or for other requests", async () => {
    const refused = Object.assign(new Error("Invalid password"), { status: "BAD_REQUEST", body: { code: "INVALID_PASSWORD" } });
    await call(hooks.after, { path: "/change-password", context: { returned: refused } });
    await call(hooks.after, { path: "/change-password", context: { returned: undefined } });
    await call(hooks.after, { path: "/update-user", context: { returned: { user: { id: "u1" } } } });
    expect(h.chosen).toEqual([]);
  });

  it("never turns a done password change into an error", async () => {
    h.fails = true;
    await expect(call(hooks.after, { path: "/change-password", context: { returned: { token: "t", user: { id: "u1" } } } })).resolves.toBeUndefined();
  });

  it("an emailed reset link ends a temporary password too", async () => {
    await auth.options.emailAndPassword!.onPasswordReset!({ user: { id: "u2" } as never }, new Request("https://example.com/api/auth/reset-password", { headers }));
    expect(h.chosen).toEqual([["u2", "reset_link", { ip: "203.0.113.5", userAgent: null }]]);
  });
});

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema/auth";
import { sendEmail } from "@/lib/email";

/**
 * Someone chose their own password through Better Auth (Password & security, or an emailed
 * reset link): a temporary one is gone. Loaded lazily because scripts import this file outside
 * the server. Never fails the password change itself.
 */
async function passwordChosen(userId: string, how: "changed" | "reset_link", requestHeaders: Headers | undefined) {
  try {
    const [{ passwordChosenBySelf }, { requestMeta }] = await Promise.all([import("@/server/passwords"), import("@/server/request-meta")]);
    await passwordChosenBySelf(userId, how, requestMeta(requestHeaders ?? new Headers()));
  } catch (e) {
    console.error(`[auth] could not record the password change for user ${userId}`, e instanceof Error ? e.message : e);
  }
}

export function trustedOrigins(base: string | undefined, extra: string | undefined): string[] {
  const out = (extra ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter((o) => /^https:\/\/[a-z0-9.-]+$/i.test(o));
  try {
    const u = new URL(base ?? "");
    if (u.protocol === "https:" && u.hostname.split(".").length >= 2) {
      const twin = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
      if (!u.hostname.endsWith(".vercel.app")) out.push(`https://${twin}`);
    }
  } catch {
    // No main address configured (local tools): nothing to add.
  }
  return [...new Set(out)];
}

export const auth = betterAuth({
  appName: "Grandview OS",
  baseURL: process.env.BETTER_AUTH_URL,
  // Other addresses the app answers on: the www/plain twin of the main address (Vercel can
  // forward either way) and any in BETTER_AUTH_TRUSTED_ORIGINS (e.g. the old *.vercel.app one).
  trustedOrigins: trustedOrigins(process.env.BETTER_AUTH_URL, process.env.BETTER_AUTH_TRUSTED_ORIGINS),
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      twoFactor: schema.twoFactor,
      rateLimit: schema.rateLimit,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // Accounts are created by the owner/admin only; there is no public sign-up.
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const r = await sendEmail({
        to: user.email,
        subject: "Reset your Grandview OS password",
        text: `A password reset was requested for your Grandview OS account.\n\nReset it here (link expires in 1 hour):\n${url}\n\nIf you didn't request this, you can ignore this email.`,
      });
      if (r.status === "failed") console.error(`[auth] password reset email to user ${user.id} failed: ${r.error}`);
    },
    onPasswordReset: async ({ user }, request) => passwordChosen(user.id, "reset_link", request?.headers),
  },
  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "painter" },
      active: { type: "boolean", input: false, defaultValue: true },
      phone: { type: "string", required: false, input: false },
      // Set when someone else chose the password; cleared when the person picks their own.
      mustChangePassword: { type: "boolean", input: false, defaultValue: false },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Re-entering a temporary password would keep the one the owner knows.
      const body = ctx.body as { currentPassword?: unknown; newPassword?: unknown } | undefined;
      if (ctx.path === "/change-password" && typeof body?.newPassword === "string" && body.newPassword === body.currentPassword) {
        throw new APIError("BAD_REQUEST", { message: "Choose a new password, different from your current one.", code: "PASSWORD_UNCHANGED" });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password") return;
      const returned = ctx.context.returned;
      if (!returned || typeof returned !== "object" || returned instanceof Error) return;
      const id = (returned as { user?: { id?: unknown } }).user?.id;
      if (typeof id === "string") await passwordChosen(id, "changed", ctx.request?.headers ?? ctx.headers);
    }),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Deactivated users cannot start new sessions.
        before: async (session) => {
          const u = await db.query.user.findFirst({ where: (t, { eq }) => eq(t.id, session.userId) });
          if (!u || !u.active) return false;
          // Development logins (known password) can never sign in to the live site.
          if (process.env.VERCEL_ENV === "production" && u.email.endsWith("@dev.grandview.local")) return false;
          return { data: session };
        },
      },
    },
  },
  advanced: {
    // Vercel sets these to the real client IP, so per-IP sign-in limits work.
    ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"] },
  },
  plugins: [twoFactor({ issuer: "Grandview OS" }), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

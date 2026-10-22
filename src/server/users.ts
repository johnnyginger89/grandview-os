import "server-only";
import { and, asc, eq, like } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ROLES, session, twoFactor, user, verification } from "@/db/schema";
import { auth } from "@/lib/auth";
import { canManageAccount, canResetSignIn } from "@/lib/authz/permissions";
import { audit } from "./audit";
import { temporaryPassword, writePassword } from "./passwords";
import type { RequestMeta } from "./request-meta";

const NO_META: RequestMeta = { ip: null, userAgent: null };

export class UserAdminError extends Error {
  readonly expose = true;
}

export async function listUsers() {
  return db.query.user.findMany({ orderBy: asc(user.name) });
}

export const newUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
});

/** Create an account with a one-time temporary password the admin passes on securely; it must be replaced at first sign-in. */
export async function createUserAccount(input: z.input<typeof newUserSchema>, actorId: string, actorRole: string, meta: RequestMeta = NO_META) {
  const v = newUserSchema.parse(input);
  if (!canManageAccount(actorRole, v.role)) throw new Error("Only the owner can create accounts that can see company financials (Owner, Operations Manager).");
  const existing = await db.query.user.findFirst({ where: eq(user.email, v.email) });
  if (existing) throw new Error("A user with that email already exists.");
  const ctx = await auth.$context;
  const tempPassword = temporaryPassword();
  const u = await ctx.internalAdapter.createUser({ email: v.email, name: v.name, emailVerified: true, role: v.role, phone: v.phone, mustChangePassword: true }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: await ctx.password.hash(tempPassword) });
  await audit({ actorId, action: "user.create", entityType: "user", entityId: u.id, after: { email: v.email, role: v.role }, ipAddress: meta.ip });
  return { id: u.id, tempPassword };
}

export async function updateUserAccess(userId: string, patch: { role?: string; active?: boolean }, actorId: string, actorRole: string, meta: RequestMeta = NO_META) {
  const target = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!target) throw new Error("User not found");
  if (userId === actorId) throw new Error("You can't change your own role or deactivate yourself.");
  const role = patch.role ? z.enum(ROLES).parse(patch.role) : undefined;
  if (!canManageAccount(actorRole, target.role) || (role && !canManageAccount(actorRole, role))) {
    throw new Error("Only the owner can change accounts that can see company financials (Owner, Operations Manager).");
  }
  await db.update(user).set({ ...(role ? { role } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}), updatedAt: new Date() }).where(eq(user.id, userId));
  // Revoke sessions so changes take effect immediately.
  await db.delete(session).where(eq(session.userId, userId));
  await audit({ actorId, action: "user.access", entityType: "user", entityId: userId, before: { role: target.role, active: target.active }, after: patch, ipAddress: meta.ip });
}

type Actor = { id: string; role: string };

/** Someone else's login, reset by the owner. Owners use Password & security for their own. */
async function resetTarget(userId: string, actor: Actor) {
  if (!canResetSignIn(actor.role)) throw new UserAdminError("Only the owner can reset someone's password or two-step sign-in.");
  if (userId === actor.id) throw new UserAdminError("Use Password & security to change your own password or two-step sign-in.");
  const target = await db.query.user.findFirst({ where: eq(user.id, userId), columns: { id: true, name: true, email: true, twoFactorEnabled: true } });
  if (!target) throw new UserAdminError("User not found.");
  return target;
}

/**
 * Forgotten password: the owner sets a temporary one to pass on privately. The person is
 * signed out everywhere and must choose their own password when they next sign in.
 */
export async function setTemporaryPassword(userId: string, actor: Actor, meta: RequestMeta): Promise<{ name: string; email: string; tempPassword: string }> {
  const target = await resetTarget(userId, actor);
  const tempPassword = temporaryPassword();
  await db.transaction(async (tx) => {
    await writePassword(tx, target.id, tempPassword, { mustChange: true });
    await audit({ actorId: actor.id, action: "user.temporary_password", entityType: "user", entityId: target.id, ipAddress: meta.ip, after: { userAgent: meta.userAgent } }, tx);
  });
  return { name: target.name, email: target.email, tempPassword };
}

/**
 * Lost phone: the owner turns off someone's two-step sign-in. They're signed out everywhere and
 * set it up again (new authenticator entry, new backup codes) when they next sign in.
 */
export async function resetTwoFactor(userId: string, actor: Actor, meta: RequestMeta): Promise<{ name: string }> {
  const target = await resetTarget(userId, actor);
  if (!target.twoFactorEnabled) throw new UserAdminError(`Two-step sign-in isn't on for ${target.name}, so there's nothing to reset.`);
  await db.transaction(async (tx) => {
    await tx.delete(twoFactor).where(eq(twoFactor.userId, target.id));
    await tx.update(user).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(user.id, target.id));
    // "Trust this device" records, so no old device skips the codes once it's set up again.
    await tx.delete(verification).where(and(eq(verification.value, target.id), like(verification.identifier, "trust-device-%")));
    await tx.delete(session).where(eq(session.userId, target.id));
    await audit({ actorId: actor.id, action: "user.two_factor_reset", entityType: "user", entityId: target.id, ipAddress: meta.ip, after: { userAgent: meta.userAgent } }, tx);
  });
  return { name: target.name };
}

import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { account, session, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { Tx } from "./attempt-limit";
import { audit } from "./audit";
import type { RequestMeta } from "./request-meta";

/** A one-time password for the owner to pass on privately (16 characters). */
export function temporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * Sets someone's sign-in password inside the caller's transaction, hashed the way Better Auth
 * checks it, and signs them out everywhere except `keepSessionId`. `mustChange` is true when
 * someone else chose the password, so they replace it at their next sign-in.
 */
export async function writePassword(tx: Tx, userId: string, password: string, opts: { mustChange: boolean; keepSessionId?: string }): Promise<void> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  const now = new Date();
  const updated = await tx
    .update(account)
    .set({ password: hash, updatedAt: now })
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential"), eq(account.accountId, userId)))
    .returning({ id: account.id });
  if (!updated.length) throw new Error("This account doesn't sign in with a password.");
  await tx.update(user).set({ mustChangePassword: opts.mustChange, updatedAt: now }).where(eq(user.id, userId));
  await tx.delete(session).where(opts.keepSessionId ? and(eq(session.userId, userId), ne(session.id, opts.keepSessionId)) : eq(session.userId, userId));
}

/** Whether `password` is the one already set, so a temporary password can't simply be chosen again. */
export async function isCurrentPassword(tx: Tx, userId: string, password: string): Promise<boolean> {
  const [row] = await tx
    .select({ hash: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential"), eq(account.accountId, userId)))
    .limit(1);
  if (!row?.hash) return false;
  const ctx = await auth.$context;
  return ctx.password.verify({ hash: row.hash, password });
}

/**
 * After someone changes their own password, or sets one from an emailed reset link: a temporary
 * password is gone, so they can use the app again. Recorded with where the request came from.
 */
export async function passwordChosenBySelf(userId: string, how: "changed" | "reset_link", meta: RequestMeta): Promise<void> {
  const cleared = await db
    .update(user)
    .set({ mustChangePassword: false, updatedAt: new Date() })
    .where(and(eq(user.id, userId), eq(user.mustChangePassword, true)))
    .returning({ id: user.id });
  await audit({
    actorId: userId,
    action: how === "changed" ? "account.password_changed" : "account.password_reset_by_link",
    entityType: "user",
    entityId: userId,
    ipAddress: meta.ip,
    after: { userAgent: meta.userAgent, replacedTemporaryPassword: cleared.length > 0 },
  });
}

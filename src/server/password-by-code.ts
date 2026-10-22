import "server-only";
import { and, count, eq, gte, ne } from "drizzle-orm";
import { db } from "@/db";
import { session as sessionTable } from "@/db/schema/auth";
import { auditLog } from "@/db/schema";
import { auth } from "@/lib/auth";
import { audit } from "./audit";

export class PasswordError extends Error {
  readonly expose = true;
}

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

/**
 * Set a new password while signed in, proven with the authenticator code instead of the
 * old password (for when it's forgotten and email isn't set up). Wrong codes are counted:
 * 5 in 15 minutes and it stops accepting tries for a while. Other devices are signed out.
 */
export async function setPasswordWithCode(input: { code: string; newPassword: string }, requestHeaders: Headers, now = new Date()): Promise<void> {
  const current = await auth.api.getSession({ headers: requestHeaders });
  if (!current) throw new PasswordError("Please sign in again.");
  const user = current.user as typeof current.user & { twoFactorEnabled?: boolean | null };
  if (!user.twoFactorEnabled) throw new PasswordError("Two-factor isn't turned on for your account, so use your current password instead.");

  const [{ n }] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, "account.password_code_failed"), gte(auditLog.createdAt, new Date(now.getTime() - WINDOW_MS))));
  if (n >= MAX_FAILURES) throw new PasswordError("Too many wrong codes. Wait 15 minutes and try again.");

  try {
    await auth.api.verifyTOTP({ body: { code: input.code }, headers: requestHeaders });
  } catch {
    await audit({ actorId: user.id, action: "account.password_code_failed", entityType: "user", entityId: user.id });
    throw new PasswordError("That code didn't match. Use the newest 6-digit code in your authenticator app.");
  }

  const ctx = await auth.$context;
  await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(input.newPassword));
  await db.delete(sessionTable).where(and(eq(sessionTable.userId, user.id), ne(sessionTable.id, current.session.id)));
  await audit({ actorId: user.id, action: "account.password_set_with_code", entityType: "user", entityId: user.id });
}

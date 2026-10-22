import "server-only";
import { auth } from "@/lib/auth";
import { audit } from "./audit";
import { withAuthenticatorCode } from "./authenticator-code";
import { isCurrentPassword, writePassword } from "./passwords";
import { requestMeta } from "./request-meta";

export class PasswordError extends Error {
  readonly expose = true;
}

/**
 * Set a new password while signed in, proven with the authenticator code instead of the
 * old password (for when it's forgotten and email isn't set up). Wrong codes are counted:
 * 5 in 15 minutes and it stops accepting tries for a while. Other devices are signed out.
 */
export async function setPasswordWithCode(input: { code: string; newPassword: string }, requestHeaders: Headers, now = new Date()): Promise<void> {
  const current = await auth.api.getSession({ headers: requestHeaders });
  if (!current) throw new PasswordError("Please sign in again.");
  const user = current.user as typeof current.user & { twoFactorEnabled?: boolean | null; mustChangePassword?: boolean | null };
  if (!user.twoFactorEnabled) throw new PasswordError("Two-factor isn't turned on for your account, so use your current password instead.");
  const meta = requestMeta(requestHeaders);

  await withAuthenticatorCode({ userId: user.id, code: input.code, failedAction: "account.password_code_failed", headers: requestHeaders, meta, now }, async (tx) => {
    if (user.mustChangePassword && (await isCurrentPassword(tx, user.id, input.newPassword))) throw new PasswordError("Choose a new password, different from your current one.");
    await writePassword(tx, user.id, input.newPassword, { mustChange: false, keepSessionId: current.session.id });
    await audit({ actorId: user.id, action: "account.password_set_with_code", entityType: "user", entityId: user.id, ipAddress: meta.ip, after: { userAgent: meta.userAgent } }, tx);
  });
}

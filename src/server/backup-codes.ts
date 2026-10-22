import "server-only";
import { eq } from "drizzle-orm";
import { generateRandomString, symmetricEncrypt } from "better-auth/crypto";
import { twoFactor } from "@/db/schema";
import { auth } from "@/lib/auth";
import { audit } from "./audit";
import { withAuthenticatorCode } from "./authenticator-code";
import { requestMeta } from "./request-meta";

export class BackupCodesError extends Error {
  readonly expose = true;
}

/** The same shape Better Auth makes: 10 codes like "a1B2c-3D4e5", each signing in once. */
export function newBackupCodes(): string[] {
  return Array.from({ length: 10 }, () => generateRandomString(10, "a-z", "0-9", "A-Z")).map((c) => `${c.slice(0, 5)}-${c.slice(5)}`);
}

/**
 * A new set of backup codes for the signed-in person, once they type the newest code from their
 * authenticator app (Better Auth's own endpoint asks for the password instead, which is often
 * the thing that's forgotten). The old codes stop working. The new ones are returned once, to show.
 */
export async function regenerateBackupCodes(input: { code: string }, requestHeaders: Headers, now = new Date()): Promise<string[]> {
  const current = await auth.api.getSession({ headers: requestHeaders });
  if (!current) throw new BackupCodesError("Please sign in again.");
  const user = current.user as typeof current.user & { twoFactorEnabled?: boolean | null };
  if (!user.twoFactorEnabled) throw new BackupCodesError("Turn on two-factor authentication first.");
  const meta = requestMeta(requestHeaders);

  return withAuthenticatorCode({ userId: user.id, code: input.code, failedAction: "account.backup_codes_code_failed", headers: requestHeaders, meta, now }, async (tx) => {
    const ctx = await auth.$context;
    const codes = newBackupCodes();
    // Stored exactly as the two-factor plugin stores them (encrypted JSON), so sign-in accepts them.
    const stored = await symmetricEncrypt({ key: ctx.secretConfig, data: JSON.stringify(codes) });
    const updated = await tx.update(twoFactor).set({ backupCodes: stored }).where(eq(twoFactor.userId, user.id)).returning({ id: twoFactor.id });
    if (!updated.length) throw new BackupCodesError("Two-factor authentication isn't set up for your account.");
    await audit({ actorId: user.id, action: "account.backup_codes_regenerated", entityType: "user", entityId: user.id, ipAddress: meta.ip, after: { userAgent: meta.userAgent } }, tx);
    return codes;
  });
}

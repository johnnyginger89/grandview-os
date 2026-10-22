import "server-only";
import { auth } from "@/lib/auth";
import { limitedAttempt, type Tx } from "./attempt-limit";
import { audit } from "./audit";
import type { RequestMeta } from "./request-meta";

export class CodeCheckError extends Error {
  readonly expose = true;
}

/** Every place a signed-in person proves it's them with their authenticator app shares one allowance of wrong codes. */
export const AUTHENTICATOR_CODE_FAILURES = ["account.password_code_failed", "account.backup_codes_code_failed"] as const;
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

/**
 * Checks the newest code from the signed-in person's authenticator app, then runs `then` in the
 * same transaction. Wrong codes are recorded under `failedAction` and counted: after 5 in 15
 * minutes no code is accepted, not even the right one, until the time has passed.
 */
export async function withAuthenticatorCode<T>(
  args: { userId: string; code: string; failedAction: (typeof AUTHENTICATOR_CODE_FAILURES)[number]; headers: Headers; meta: RequestMeta; now?: Date },
  then: (tx: Tx) => Promise<T>,
): Promise<T> {
  const { userId, meta } = args;
  const rule = { key: `authenticator-code:${userId}`, failures: AUTHENTICATOR_CODE_FAILURES, actorId: userId, max: MAX_FAILURES, windowMs: WINDOW_MS };
  const outcome = await limitedAttempt(rule, args.now ?? new Date(), async (tx) => {
    try {
      await auth.api.verifyTOTP({ body: { code: args.code }, headers: args.headers });
    } catch {
      await audit({ actorId: userId, action: args.failedAction, entityType: "user", entityId: userId, ipAddress: meta.ip, after: { userAgent: meta.userAgent } }, tx);
      return { matched: false as const };
    }
    return { matched: true as const, value: await then(tx) };
  });
  if (outcome.status === "busy") throw new CodeCheckError("Still checking your last code. Try again in a moment.");
  if (outcome.status === "limited") throw new CodeCheckError("Too many wrong codes. Wait 15 minutes and try again.");
  if (!outcome.value.matched) throw new CodeCheckError("That code didn't match. Use the newest 6-digit code in your authenticator app.");
  return outcome.value.value;
}

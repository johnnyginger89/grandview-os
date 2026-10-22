import "server-only";
import { scrypt } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, user } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { formatDateTime } from "@/lib/utils";
import { limitedAttempt } from "./attempt-limit";
import { audit } from "./audit";
import { notify, notifyLater } from "./notifications";
import { writePassword } from "./passwords";
import type { RequestMeta } from "./request-meta";
import { setupTokenMatches } from "./setup";

/*
 * Owner locked out (password forgotten, email not set up): the owner puts a long code in
 * Vercel as OWNER_RECOVERY_CODE and redeploys, then /recover sets a new password for an
 * owner account. Only someone with access to the hosting settings can do that. Two-factor
 * is still asked for at sign-in. A code works once; wrong codes are limited to 5 an hour,
 * counting everyone's; owners are told about every recovery. Delete the code from Vercel
 * afterwards.
 */
export function recoveryConfigured(): boolean {
  return (process.env.OWNER_RECOVERY_CODE ?? "").length >= 32;
}

export const recoverySchema = z
  .object({
    code: z.string().min(1, "Enter the recovery code from Vercel").max(500),
    email: z.string().trim().toLowerCase().email("Enter your email"),
    password: z.string().min(12, "Use at least 12 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

export class RecoveryError extends Error {
  readonly expose = true;
}

const MAX_WRONG_CODES = 5;
const WINDOW_MS = 60 * 60_000;
const FAILED = "account.owner_recovery_failed";
const RECOVERED = "account.owner_recovered";

const scryptAsync = promisify(scrypt) as (code: string, salt: string, length: number) => Promise<Buffer>;

/** What's kept of a used code: a slow one-way fingerprint, so the database never holds the code. */
export async function codeFingerprint(code: string): Promise<string> {
  return (await scryptAsync(code, "grandview-os/owner-recovery-code", 32)).toString("hex");
}

type Outcome = { kind: "wrong_code" | "used_code" | "no_owner" } | { kind: "recovered"; owner: { id: string; email: string } };

export async function recoverOwner(raw: z.input<typeof recoverySchema>, meta: RequestMeta, now = new Date()): Promise<void> {
  const v = recoverySchema.parse(raw);
  const configured = process.env.OWNER_RECOVERY_CODE ?? "";
  const rule = { key: "owner-recovery", failures: [FAILED], actorId: null, max: MAX_WRONG_CODES, windowMs: WINDOW_MS };

  const outcome = await limitedAttempt(rule, now, async (tx): Promise<Outcome> => {
    const refuse = async (kind: "wrong_code" | "used_code"): Promise<Outcome> => {
      await audit({ actorId: null, action: FAILED, entityType: "owner_recovery", ipAddress: meta.ip, after: { reason: kind, userAgent: meta.userAgent } }, tx);
      return { kind };
    };
    if (!recoveryConfigured() || !setupTokenMatches(v.code, configured)) return refuse("wrong_code");
    const fingerprint = await codeFingerprint(configured);
    const [used] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, RECOVERED), sql`${auditLog.after}->>'codeFingerprint' = ${fingerprint}`))
      .limit(1);
    if (used) return refuse("used_code");
    const owner = await tx.query.user.findFirst({ where: and(eq(user.email, v.email), eq(user.role, "owner")), columns: { id: true, email: true } });
    if (!owner) return { kind: "no_owner" };
    await writePassword(tx, owner.id, v.password, { mustChange: false });
    // The fingerprint in this entry is what makes the code single-use.
    await audit({ actorId: owner.id, action: RECOVERED, entityType: "user", entityId: owner.id, ipAddress: meta.ip, after: { userAgent: meta.userAgent, codeFingerprint: fingerprint } }, tx);
    return { kind: "recovered", owner };
  });

  if (outcome.status === "busy") throw new RecoveryError("Another recovery try is being checked. Wait a moment and try again.");
  if (outcome.status === "limited") throw new RecoveryError("Too many wrong recovery codes in the last hour. Wait an hour and try again.");
  const r = outcome.value;
  if (r.kind !== "recovered") throw new RecoveryError(REFUSED[r.kind]);
  await tellOwners(r.owner, meta, now);
}

const REFUSED = {
  wrong_code: "That recovery code doesn't match the one in Vercel.",
  used_code: "That recovery code has already been used. Put a new one in Vercel (OWNER_RECOVERY_CODE), redeploy, then try again.",
  no_owner: "No owner account has that email.",
} as const;

/** Best effort: the password is already changed, so nothing here may fail the recovery. */
async function tellOwners(owner: { id: string; email: string }, meta: RequestMeta, when: Date): Promise<void> {
  const from = meta.ip ? ` from ${meta.ip}` : "";
  try {
    const owners = await db.select({ id: user.id }).from(user).where(and(eq(user.role, "owner"), eq(user.active, true)));
    await notify([owner.id, ...owners.map((o) => o.id)], {
      kind: "account.owner_recovered",
      title: `The password for ${owner.email} was reset on the recovery page`,
      body: `${formatDateTime(when)}${from}. If this wasn't you, someone has the recovery code in Vercel: tell your developer straight away.`,
      href: "/account/security",
    });
  } catch (e) {
    console.error("[owner-recovery] in-app notice failed", e instanceof Error ? e.message : e);
  }
  notifyLater(async () => {
    try {
      const r = await sendEmail({
        to: owner.email,
        subject: "Your Grandview OS password was reset with the recovery code",
        text:
          `The password for ${owner.email} was reset on the Grandview OS recovery page (${formatDateTime(when)}${from}).\n\n` +
          `If this was you: delete OWNER_RECOVERY_CODE in Vercel and redeploy. The code won't work again.\n\n` +
          `If it wasn't you: someone has the recovery code from Vercel. Tell your developer straight away. Your two-step sign-in still protects the account.`,
      });
      if (r.status === "failed") console.error(`[owner-recovery] alert email to owner ${owner.id} failed: ${r.error}`);
    } catch (e) {
      console.error("[owner-recovery] alert email failed", e instanceof Error ? e.message : e);
    }
  });
}

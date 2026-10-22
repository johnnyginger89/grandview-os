import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { session, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { audit } from "./audit";
import { setupTokenMatches } from "./setup";

/*
 * Owner locked out (password forgotten, email not set up): the owner puts a long code in
 * Vercel as OWNER_RECOVERY_CODE and redeploys, then /recover sets a new password for an
 * owner account. Only someone with access to the hosting settings can do that. Two-factor
 * is still asked for at sign-in. Delete the code from Vercel afterwards.
 */
export function recoveryConfigured(): boolean {
  return (process.env.OWNER_RECOVERY_CODE ?? "").length >= 32;
}

export const recoverySchema = z
  .object({
    code: z.string().min(1, "Enter the recovery code from Vercel"),
    email: z.string().trim().toLowerCase().email("Enter your email"),
    password: z.string().min(12, "Use at least 12 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

export class RecoveryError extends Error {
  readonly expose = true;
}

export async function recoverOwner(raw: z.input<typeof recoverySchema>): Promise<void> {
  const v = recoverySchema.parse(raw);
  if (!recoveryConfigured() || !setupTokenMatches(v.code, process.env.OWNER_RECOVERY_CODE ?? "")) throw new RecoveryError("That recovery code doesn't match the one in Vercel.");
  const owner = await db.query.user.findFirst({ where: and(eq(user.email, v.email), eq(user.role, "owner")), columns: { id: true } });
  if (!owner) throw new RecoveryError("No owner account has that email.");
  const ctx = await auth.$context;
  await ctx.internalAdapter.updatePassword(owner.id, await ctx.password.hash(v.password));
  await db.delete(session).where(eq(session.userId, owner.id));
  await audit({ actorId: owner.id, action: "account.owner_recovered", entityType: "user", entityId: owner.id });
}

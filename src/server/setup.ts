import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { audit } from "./audit";

/**
 * First-run owner creation. There is no public sign-up, so a brand-new
 * database needs one way in: /setup, usable only while no owner exists and
 * only with the SETUP_TOKEN the owner put in the hosting settings.
 */
export function setupConfigured(): boolean {
  return (process.env.SETUP_TOKEN ?? "").length >= 32;
}

export function setupTokenMatches(provided: string, expected = process.env.SETUP_TOKEN ?? ""): boolean {
  if (expected.length < 32) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function ownerExists(): Promise<boolean> {
  const row = await db.query.user.findFirst({ where: eq(user.role, "owner"), columns: { id: true } });
  return !!row;
}

export const setupSchema = z
  .object({
    token: z.string().min(1, "Setup code is required"),
    name: z.string().trim().min(1, "Name is required").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email"),
    password: z.string().min(12, "Use at least 12 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

export class SetupError extends Error {
  readonly expose = true;
}

export async function createFirstOwner(raw: z.input<typeof setupSchema>) {
  const v = setupSchema.parse(raw);
  if (!setupConfigured() || !setupTokenMatches(v.token)) throw new SetupError("That setup code is not valid.");

  return db.transaction(async (tx) => {
    // Serialize concurrent attempts, then re-check inside the lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('grandview-os:first-owner'))`);
    const existing = await tx.query.user.findFirst({ where: eq(user.role, "owner"), columns: { id: true } });
    if (existing) throw new SetupError("Setup has already been completed.");
    const emailTaken = await tx.query.user.findFirst({ where: eq(user.email, v.email), columns: { id: true } });
    if (emailTaken) throw new SetupError("An account with that email already exists.");

    const ctx = await auth.$context;
    const u = await ctx.internalAdapter.createUser({ email: v.email, name: v.name, emailVerified: true, role: "owner" }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: await ctx.password.hash(v.password) });
    await audit({ actorId: u.id, action: "setup.first_owner", entityType: "user", entityId: u.id, after: { email: v.email } }, tx);
    return { id: u.id };
  });
}

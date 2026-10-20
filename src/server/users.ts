import "server-only";
import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ROLES, session, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { audit } from "./audit";

export async function listUsers() {
  return db.query.user.findMany({ orderBy: asc(user.name) });
}

export const newUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
});

/** Create an account with a one-time temporary password the admin passes on securely. */
export async function createUserAccount(input: z.input<typeof newUserSchema>, actorId: string, actorRole: string) {
  const v = newUserSchema.parse(input);
  if (v.role === "owner" && actorRole !== "owner") throw new Error("Only the owner can create another owner account.");
  const existing = await db.query.user.findFirst({ where: eq(user.email, v.email) });
  if (existing) throw new Error("A user with that email already exists.");
  const ctx = await auth.$context;
  const tempPassword = randomBytes(12).toString("base64url");
  const u = await ctx.internalAdapter.createUser({ email: v.email, name: v.name, emailVerified: true, role: v.role, phone: v.phone }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: await ctx.password.hash(tempPassword) });
  await audit({ actorId, action: "user.create", entityType: "user", entityId: u.id, after: { email: v.email, role: v.role } });
  return { id: u.id, tempPassword };
}

export async function updateUserAccess(userId: string, patch: { role?: string; active?: boolean }, actorId: string, actorRole: string) {
  const target = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!target) throw new Error("User not found");
  if (userId === actorId) throw new Error("You can't change your own role or deactivate yourself.");
  if ((target.role === "owner" || patch.role === "owner") && actorRole !== "owner") throw new Error("Only the owner can change owner accounts.");
  const role = patch.role ? z.enum(ROLES).parse(patch.role) : undefined;
  await db.update(user).set({ ...(role ? { role } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}), updatedAt: new Date() }).where(eq(user.id, userId));
  // Revoke sessions so changes take effect immediately.
  await db.delete(session).where(eq(session.userId, userId));
  await audit({ actorId, action: "user.access", entityType: "user", entityId: userId, before: { role: target.role, active: target.active }, after: patch });
}

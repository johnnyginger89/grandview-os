/** Shared helpers for *.db.test.ts files. Everything they create is obviously fake. */
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { user, type Role } from "@/db/schema";

/** A short random tag that keeps names, codes and emails unique to one test run. */
export const uniqueTag = () => randomUUID().slice(0, 8);

/** A team member to act as (audit log, created by, estimator). It has no password, so it can't sign in. */
export async function createTestUser(role: Role, label: string = role) {
  const tag = uniqueTag();
  const [row] = await db
    .insert(user)
    .values({ id: `dbtest-${tag}`, name: `[TEST DATA] ${label} ${tag}`, email: `dbtest-${tag}@example.com`, emailVerified: true, role })
    .returning();
  return row;
}

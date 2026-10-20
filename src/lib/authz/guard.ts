import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/db/schema/auth";
import { auth } from "@/lib/auth";
import { can, MFA_REQUIRED_ROLES, type Permission } from "./permissions";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  twoFactorEnabled: boolean;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: Role; active?: boolean; twoFactorEnabled?: boolean | null };
  if (u.active === false) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: (u.role ?? "painter") as Role,
    twoFactorEnabled: !!u.twoFactorEnabled,
  };
});

export function mfaEnforced(): boolean {
  return process.env.MFA_ENFORCED !== "false";
}

export function needsMfaEnrollment(user: CurrentUser): boolean {
  return mfaEnforced() && MFA_REQUIRED_ROLES.includes(user.role) && !user.twoFactorEnabled;
}

/** For pages: redirect to login when signed out, to MFA setup when required. */
export async function requireUser(opts: { allowMfaPending?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!opts.allowMfaPending && needsMfaEnrollment(user)) redirect("/account/security?setup=1");
  return user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/no-access");
  return user;
}

export class AuthorizationError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** For server actions: throws instead of redirecting so callers can return an error. */
export async function assertPermission(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("Your session has expired. Please sign in again.");
  if (needsMfaEnrollment(user)) throw new AuthorizationError("Set up two-factor authentication first.");
  if (!can(user.role, permission)) throw new AuthorizationError();
  return user;
}

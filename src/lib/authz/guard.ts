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
  /** Signed in with a password someone else set (a new login, or the owner's reset). */
  mustChangePassword: boolean;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: Role; active?: boolean; twoFactorEnabled?: boolean | null; mustChangePassword?: boolean | null };
  if (u.active === false) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: (u.role ?? "painter") as Role,
    twoFactorEnabled: !!u.twoFactorEnabled,
    mustChangePassword: !!u.mustChangePassword,
  };
});

/** Two-factor is always mandatory on the live site; MFA_ENFORCED=false only works locally. */
export function mfaEnforced(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.MFA_ENFORCED !== "false";
}

/** The role needs two-step sign-in and it isn't turned on yet. */
export function needsTwoFactorSetup(user: CurrentUser): boolean {
  return mfaEnforced() && MFA_REQUIRED_ROLES.includes(user.role) && !user.twoFactorEnabled;
}

/** The password was set by someone else, so the person must choose their own first. */
export function needsPasswordChange(user: CurrentUser): boolean {
  return user.mustChangePassword;
}

/**
 * Signed in, but nothing else may be used until the account is ready: a password someone else
 * set is replaced, and two-step sign-in is on where the role needs it. Pages send the person to
 * Password & security; server actions and API routes refuse.
 */
export function needsAccountSetup(user: CurrentUser): boolean {
  return needsPasswordChange(user) || needsTwoFactorSetup(user);
}

export function accountSetupMessage(user: CurrentUser): string {
  return needsPasswordChange(user) ? "Choose your own password first (Password & security)." : "Set up two-factor authentication first.";
}

/** For pages: redirect to login when signed out, to Password & security until the account is set up. */
export async function requireUser(opts: { allowSetupPending?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!opts.allowSetupPending) {
    if (needsPasswordChange(user)) redirect("/account/security?change=1");
    if (needsTwoFactorSetup(user)) redirect("/account/security?setup=1");
  }
  return user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/no-access");
  return user;
}

export class AuthorizationError extends Error {
  readonly expose = true;
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** For server actions: throws instead of redirecting so callers can return an error. */
export async function assertPermission(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("Your session has expired. Please sign in again.");
  if (needsAccountSetup(user)) throw new AuthorizationError(accountSetupMessage(user));
  if (!can(user.role, permission)) throw new AuthorizationError();
  return user;
}

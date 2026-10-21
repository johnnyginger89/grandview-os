import type { Role } from "@/db/schema/auth";

/**
 * Role → permission matrix. This is the single source of truth: every server
 * action and page checks permissions through `can()` / `requirePermission()`.
 * Hiding a button in the UI is never the only protection.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "customers.read",
  "customers.write",
  "customers.delete",
  "pipeline.read",
  "pipeline.write",
  "messages.send",
  "estimates.read",
  "estimates.write",
  /** Internal costing: labour cost, material cost, margin, markup. */
  "estimates.costing",
  "rates.read",
  "rates.write",
  "projects.read_all",
  "projects.read_assigned",
  "projects.write",
  "financials.read",
  "settings.manage",
  "users.manage",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "financials.read"),
  operations_manager: [
    "dashboard.view",
    "customers.read",
    "customers.write",
    "pipeline.read",
    "pipeline.write",
    "messages.send",
    "estimates.read",
    "estimates.write",
    "estimates.costing",
    "rates.read",
    "rates.write",
    "projects.read_all",
    "projects.write",
    "financials.read",
    "audit.read",
  ],
  estimator: [
    "dashboard.view",
    "customers.read",
    "customers.write",
    "pipeline.read",
    "pipeline.write",
    "messages.send",
    "estimates.read",
    "estimates.write",
    "estimates.costing",
    "rates.read",
  ],
  project_manager: [
    "dashboard.view",
    "customers.read",
    "pipeline.read",
    "estimates.read",
    "estimates.costing",
    "rates.read",
    "projects.read_all",
    "projects.write",
  ],
  crew_leader: ["projects.read_assigned"],
  painter: ["projects.read_assigned"],
  subcontractor: ["projects.read_assigned"],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Administrator",
  operations_manager: "Operations Manager",
  estimator: "Estimator",
  project_manager: "Project Manager",
  crew_leader: "Crew Leader",
  painter: "Painter",
  subcontractor: "Subcontractor",
};

/** Roles that must use multi-factor authentication. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ["owner", "admin", "operations_manager", "estimator", "project_manager"];

export function permissionsFor(role: Role | string | null | undefined): readonly Permission[] {
  if (!role || !(role in MATRIX)) return [];
  return MATRIX[role as Role];
}

export function can(role: Role | string | null | undefined, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export function isFieldRole(role: Role | string | null | undefined): boolean {
  return role === "crew_leader" || role === "painter" || role === "subcontractor";
}

/**
 * Accounts that can see company financials (owner, operations manager) may only be
 * created, changed or deactivated by the owner, so an administrator can't give
 * themselves money access through a second login.
 */
export function canManageAccount(actorRole: Role | string | null | undefined, targetRole: Role | string | null | undefined): boolean {
  return actorRole === "owner" || !can(targetRole, "financials.read");
}

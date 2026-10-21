import { describe, expect, it } from "vitest";
import { can, canManageAccount, isFieldRole, PERMISSIONS, permissionsFor } from "./permissions";

describe("permission matrix", () => {
  it("keeps money away from field roles and administrators", () => {
    for (const role of ["crew_leader", "painter", "subcontractor", "admin", "estimator", "project_manager"]) {
      expect(can(role, "financials.read"), role).toBe(false);
    }
    expect(can("owner", "financials.read")).toBe(true);
    expect(can("operations_manager", "financials.read")).toBe(true);
    expect(isFieldRole("painter")).toBe(true);
  });

  it("only lets the owner manage accounts that can see financials", () => {
    expect(canManageAccount("admin", "operations_manager")).toBe(false);
    expect(canManageAccount("admin", "owner")).toBe(false);
    expect(canManageAccount("admin", "estimator")).toBe(true);
    expect(canManageAccount("operations_manager", "operations_manager")).toBe(false);
    expect(canManageAccount("owner", "operations_manager")).toBe(true);
  });
});

describe("schedule permissions", () => {
  const SCHEDULE = ["schedule.read", "schedule.write", "schedule.manage"] as const;

  it("gives field roles nothing new: they only ever have projects.read_assigned", () => {
    for (const role of ["crew_leader", "painter", "subcontractor"]) {
      expect(permissionsFor(role), role).toEqual(["projects.read_assigned"]);
      for (const p of SCHEDULE) expect(can(role, p), `${role} ${p}`).toBe(false);
    }
  });

  it("lets estimators read the schedule only", () => {
    expect(SCHEDULE.map((p) => can("estimator", p))).toEqual([true, false, false]);
  });

  it("lets project managers book jobs and send start notices, but not manage crews", () => {
    expect(SCHEDULE.map((p) => can("project_manager", p))).toEqual([true, true, false]);
    expect(can("project_manager", "messages.send")).toBe(true);
    expect(can("project_manager", "financials.read")).toBe(false);
  });

  it("gives operations managers, admins and owners everything on the schedule", () => {
    for (const role of ["operations_manager", "admin", "owner"]) for (const p of SCHEDULE) expect(can(role, p), `${role} ${p}`).toBe(true);
  });

  it("knows every permission in the matrix", () => {
    for (const p of SCHEDULE) expect(PERMISSIONS).toContain(p);
    expect(permissionsFor("owner")).toEqual(PERMISSIONS);
    expect(permissionsFor("nobody")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { can, canManageAccount, isFieldRole } from "./permissions";

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

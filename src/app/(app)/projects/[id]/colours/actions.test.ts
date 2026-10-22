import { describe, expect, it, vi } from "vitest";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const FORM = "00000000-0000-4000-8000-000000000002";
const ENTRY = "00000000-0000-4000-8000-000000000003";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/authz/guard", () => ({
  AuthorizationError: class extends Error {},
  assertPermission: async () => ({ id: "owner-1", role: "owner" }),
  getCurrentUser: async () => ({ id: "painter-1", role: "painter" }),
  needsMfaEnrollment: () => false,
}));
vi.mock("@/server/colour-selections", () => ({
  cancelColourSelection: async () => ({ projectId: PROJECT }),
  colourConsultProject: async () => PROJECT,
  createColourLink: async () => ({ projectId: PROJECT }),
  getColourFormForStaff: async () => ({ id: FORM, projectId: PROJECT }),
  saveColourSelection: async () => ({ projectId: PROJECT }),
  signColourSelectionOnDevice: async () => ({ id: FORM, projectId: PROJECT }),
  startColourSelection: async () => ({ id: FORM, projectId: PROJECT }),
}));

const office = await import("./actions");
const consultant = await import("@/app/(app)/my-jobs/colours/actions");

// Issued work orders only change when someone issues a new version, so signing mustn't claim otherwise.
describe("after colours are signed on a device", () => {
  it("the office is told to issue a new version of the work order", async () => {
    expect(await office.signColoursAction(FORM, {})).toEqual({ ok: true, message: "Signed. The colours are on the job. They'll be on the work order when you issue a new version." });
  });

  it("the colour consultant is told the office will put them on the work order", async () => {
    expect(await consultant.signFieldColoursAction(ENTRY, FORM, {})).toEqual({
      ok: true,
      message: "Signed. The office has the colours now. They'll be on the work order when the office issues a new version.",
    });
  });
});

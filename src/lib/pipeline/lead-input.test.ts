import { describe, expect, it } from "vitest";
import { cleanInboundLead, identifiesPerson, LEAD_TEXT_MAX, PROJECT_TYPES_MAX } from "./lead-input";

describe("cleanInboundLead: keep whatever is readable", () => {
  it("keeps a valid lead as it is, tidied", () => {
    const lead = cleanInboundLead({ firstName: "  Ann ", lastName: "Lee", email: " Ann@Example.COM ", phone: "604-555-0100", projectTypes: ["Interior", " Cabinets "], description: "Two rooms" });
    expect(lead).toMatchObject({ firstName: "Ann", lastName: "Lee", email: "ann@example.com", phone: "604-555-0100", projectTypes: ["Interior", "Cabinets"], description: "Two rooms", notes: null });
  });

  it("drops an email that isn't valid and keeps it as a note", () => {
    const lead = cleanInboundLead({ firstName: "Ann", email: "ann@example", phone: "604-555-0100" });
    expect(lead.email).toBeNull();
    expect(lead.firstName).toBe("Ann");
    expect(lead.notes).toBe("Email as received: ann@example");
  });

  it("cuts text that is too long to fit and says so", () => {
    const long = "x".repeat(LEAD_TEXT_MAX + 500);
    const lead = cleanInboundLead({ firstName: "Ann", description: long, street: `1 Main St ${long}` });
    expect(lead.description).toHaveLength(LEAD_TEXT_MAX);
    expect(lead.street!.length).toBeLessThanOrEqual(LEAD_TEXT_MAX);
    expect(lead.notes).toBe("Too long to keep in full, so shortened: address, message. The full text is saved with the original submission.");
  });

  it("trims long and surplus project types, and drops duplicates", () => {
    const many = Array.from({ length: PROJECT_TYPES_MAX + 5 }, (_, i) => `Type ${i}`);
    const lead = cleanInboundLead({ firstName: "Ann", projectTypes: ["Interior", "Interior", "y".repeat(150), ...many] });
    expect(lead.projectTypes).toHaveLength(PROJECT_TYPES_MAX);
    expect(lead.projectTypes[0]).toBe("Interior");
    expect(lead.projectTypes[1]).toHaveLength(100);
    expect(lead.notes).toContain("shortened: project types");
  });

  it("keeps a visit time it can't read as a note instead of failing", () => {
    const lead = cleanInboundLead({ firstName: "Ann", visitAt: "sometime next week" });
    expect(lead.visitAt).toBeNull();
    expect(lead.notes).toBe("Visit time as received: sometime next week");
    expect(cleanInboundLead({ firstName: "Ann", visitAt: "2026-10-29T09:30" }).visitAt).toBe("2026-10-29T09:30");
  });

  it("ignores blank fields", () => {
    const lead = cleanInboundLead({ firstName: "Ann", lastName: "   ", email: "  ", phone: "", city: null, projectTypes: ["", "  "] });
    expect(lead).toMatchObject({ lastName: null, email: null, phone: null, city: null, projectTypes: [], notes: null });
  });

  it("adds its notes after any notes that came with the lead", () => {
    expect(cleanInboundLead({ firstName: "Ann", email: "nope", notes: "Prefers texts" }).notes).toBe("Prefers texts\nEmail as received: nope");
  });
});

describe("identifiesPerson", () => {
  it("needs a name, company, valid email or phone", () => {
    expect(identifiesPerson(cleanInboundLead({ firstName: "Ann" }))).toBe(true);
    expect(identifiesPerson(cleanInboundLead({ company: "Strata Corp" }))).toBe(true);
    expect(identifiesPerson(cleanInboundLead({ email: "ann@example.com" }))).toBe(true);
    expect(identifiesPerson(cleanInboundLead({ phone: "604 555 0100" }))).toBe(true);
    expect(identifiesPerson(cleanInboundLead({ description: "Please call me", city: "Surrey" }))).toBe(false);
    expect(identifiesPerson(cleanInboundLead({ firstName: " - ", phone: "()" }))).toBe(false);
  });

  it("doesn't count an email that isn't valid", () => {
    expect(identifiesPerson(cleanInboundLead({ email: "ann at example dot com" }))).toBe(false);
  });
});

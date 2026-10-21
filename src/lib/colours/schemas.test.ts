import { describe, expect, it } from "vitest";
import { colourDraftSchema, colourFormSettingsSchema, colourLabel, colourSignSchema, splitColour } from "./schemas";

const SIGNATURE = `data:image/png;base64,${"A".repeat(300)}`;
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, room: "Kitchen", surface: "Walls", colour: "Alabaster", code: "SW 7008", sheen: "Eggshell", ...extra });
const client = { name: "Kim Lee [TEST DATA]", email: "kim@example.com", phone: "604-555-0100", address: "1 Example St" };

describe("splitColour", () => {
  it.each([
    ["SW 7008 Alabaster", "SW 7008", "Alabaster"],
    ["sw7008 Alabaster", "SW7008", "Alabaster"],
    ["OC-17 White Dove", "OC-17", "White Dove"],
    ["2124-70 Distant Gray", "2124-70", "Distant Gray"],
    ["Chantilly Lace", "", "Chantilly Lace"],
    ["SW 7008", "SW 7008", ""],
    ["", "", ""],
  ])("%s", (value, code, colour) => {
    expect(splitColour(value)).toEqual({ code, colour });
  });

  it("joins back into one label", () => {
    expect(colourLabel({ code: "SW 7008", colour: "Alabaster" })).toBe("SW 7008 Alabaster");
    expect(colourLabel({ code: "", colour: "Alabaster" })).toBe("Alabaster");
  });
});

describe("colour form input", () => {
  it("drops empty rows and tidies spacing", () => {
    const v = colourDraftSchema.parse({ rows: [row("a", { room: "  Main   bath " }), row("b", { room: "", surface: "", colour: "", code: "", sheen: "" })], client, notes: " " });
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0].room).toBe("Main bath");
    expect(v.notes).toBeNull();
  });

  it("refuses duplicate rows and a bad email", () => {
    expect(() => colourDraftSchema.parse({ rows: [row("a"), row("a")], client })).toThrow(/listed twice/);
    expect(() => colourDraftSchema.parse({ rows: [row("a")], client: { ...client, email: "nope" } })).toThrow(/email/);
  });

  it("needs both notes ticked, a name and a drawn signature to sign", () => {
    const ok = { rows: [row("a")], client, signedName: "Kim Lee", signature: SIGNATURE, agreeChange: true, agreeCoverage: true };
    expect(colourSignSchema.parse(ok).signedName).toBe("Kim Lee");
    expect(() => colourSignSchema.parse({ ...ok, agreeChange: false })).toThrow(/changing colours/);
    expect(() => colourSignSchema.parse({ ...ok, agreeCoverage: false })).toThrow(/whites and bright colours/);
    expect(() => colourSignSchema.parse({ ...ok, signature: "data:image/png;base64,x" })).toThrow(/sign in the box/);
    expect(() => colourSignSchema.parse({ ...ok, signedName: "K" })).toThrow(/full name/);
  });

  it("has starter wording and lists", () => {
    const s = colourFormSettingsSchema.parse({});
    expect(s.changeWarning).toMatch(/after the paint has been ordered/);
    expect(s.coverageWarning).toMatch(/third coat/);
    expect(s.sheens).toContain("Eggshell");
    expect(s.linkDays).toBe(30);
  });
});

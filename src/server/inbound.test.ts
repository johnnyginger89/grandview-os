import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { parseLenientJsonObject, payloadToLead } = await import("./inbound");

describe("webhook body parsing", () => {
  it("parses valid JSON normally", () => {
    expect(parseLenientJsonObject('{"firstName":"Ann","email":"a@example.com"}')).toEqual({ firstName: "Ann", email: "a@example.com" });
  });
  it("recovers when customer text contains quotes and line breaks", () => {
    const body = `{
  "event": "booked",
  "bookingId": "ABC123",
  "firstName": "Ann",
  "email": "ann@example.com",
  "startTime": "Thursday, October 29, 2026 9:30 AM",
  "description": "Repaint the "big" room,
plus trim, ceilings: "maybe""
}`;
    const p = parseLenientJsonObject(body)!;
    expect(p.bookingId).toBe("ABC123");
    expect(p.startTime).toBe("Thursday, October 29, 2026 9:30 AM");
    expect(p.description).toBe('Repaint the "big" room,\nplus trim, ceilings: "maybe"');
  });
  it("maps YouCanBook.me form fields onto a lead", () => {
    const lead = payloadToLead({ firstName: "Ann", address: "1 Main St", unit: "4", city: "Surrey", postalCode: "V3S 1A1", projectTypes: "Interior, Cabinets", phone: "604-555-0100" });
    expect(lead).toMatchObject({ street: "1 Main St", unit: "4", city: "Surrey", postalCode: "V3S 1A1", projectTypes: ["Interior", "Cabinets"], phone: "604-555-0100" });
  });
  it("returns null for non-object garbage", () => {
    expect(parseLenientJsonObject("hello")).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { bookingEvent, bookingKey, parseLenientJsonObject, payloadToLead, readFormBody, unreadableText } = await import("./inbound");

const post = (body: BodyInit, type?: string) => new Request("http://localhost/api/inbound/form", { method: "POST", body, headers: type ? { "content-type": type } : {} });

describe("website form bodies", () => {
  it("reads JSON, form posts and multipart uploads", async () => {
    expect(await readFormBody(post('{"name":"Ann","email":"a@example.com"}', "application/json"))).toEqual({ name: "Ann", email: "a@example.com" });
    expect(await readFormBody(post("name=Ann+Lee&message=Hi%21", "application/x-www-form-urlencoded"))).toEqual({ name: "Ann Lee", message: "Hi!" });
    const form = new FormData();
    form.set("name", "Ann");
    form.set("photo", new File(["x"], "deck.jpg"));
    expect(await readFormBody(post(form))).toEqual({ name: "Ann", photo: "deck.jpg" });
  });

  it("keeps a body it can't read as text instead of rejecting it", async () => {
    const body = await readFormBody(post("Ann Lee, call me on 604-555-0100", "application/json"));
    expect(body).toEqual({ unparseable: "Ann Lee, call me on 604-555-0100" });
    expect(unreadableText(body)).toBe("Ann Lee, call me on 604-555-0100");
    expect(unreadableText({ name: "Ann" })).toBeNull();
    expect(unreadableText({ unparseable: "x", name: "Ann" })).toBeNull();
  });
});

describe("booking events", () => {
  it("defaults to a booking and reads cancellations", () => {
    expect(bookingEvent({ bookingId: "A1" })).toBe("booked");
    expect(bookingEvent({ event: "Cancelled" })).toBe("cancelled");
  });

  it("keys each change of a booking once; a reschedule includes its new time", () => {
    expect(bookingKey({ bookingId: "A1", event: "booked", startTime: "2026-10-29T09:30" })).toBe("A1:booked:");
    expect(bookingKey({ bookingId: "A1", event: "rescheduled", startTime: "2026-10-30T09:30" })).toBe("A1:rescheduled:2026-10-30T09:30");
    expect(bookingKey({ event: "booked" })).toBeNull();
  });
});

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

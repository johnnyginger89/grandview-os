import { describe, expect, it } from "vitest";
import { customerReach, followUpAddress, sameEmail, samePhone } from "./customer-reach";

describe("customerReach", () => {
  const customer = { email: "office@example.com", phone: "604-555-0150" };

  it("is the primary contact's email and phone", () => {
    expect(customerReach(customer, { email: "kim@example.com", phone: "604-555-0100" })).toEqual({ email: "kim@example.com", phone: "604-555-0100" });
  });

  it("falls back to the customer's own, field by field", () => {
    expect(customerReach(customer, { email: " ", phone: "604-555-0100" })).toEqual({ email: "office@example.com", phone: "604-555-0100" });
    expect(customerReach(customer, null)).toEqual(customer);
    expect(customerReach(null, null)).toEqual({ email: null, phone: null });
  });
});

describe("matching", () => {
  it("compares emails without case or spaces, and phones by their digits", () => {
    expect(sameEmail(" Kim@Example.com", "kim@example.com")).toBe(true);
    expect(sameEmail("", null)).toBe(true);
    expect(sameEmail("kim@example.com", null)).toBe(false);
    expect(samePhone("604-555-0100", "(604) 555 0100")).toBe(true);
    expect(samePhone("1 604 555 0100", "604-555-0100")).toBe(true);
    expect(samePhone("604-555-0100", "604-555-0101")).toBe(false);
    expect(samePhone("", null)).toBe(true);
  });
});

describe("followUpAddress", () => {
  const onFile = ["kim.lee@example.com", "lee@example.com", null];

  it("goes back to where the proposal went while that address is still on file", () => {
    expect(followUpAddress("lee@example.com", onFile, "kim.lee@example.com")).toBe("lee@example.com");
    expect(followUpAddress("LEE@example.com ", onFile, "kim.lee@example.com")).toBe("LEE@example.com");
  });

  it("picks up a corrected address", () => {
    expect(followUpAddress("kim@example.con", onFile, "kim.lee@example.com")).toBe("kim.lee@example.com");
  });

  it("keeps the old address when the customer has no email now, and uses the current one when nothing was sent", () => {
    expect(followUpAddress("kim@example.com", [null], null)).toBe("kim@example.com");
    expect(followUpAddress(null, onFile, "kim.lee@example.com")).toBe("kim.lee@example.com");
    expect(followUpAddress(null, [], null)).toBeNull();
  });
});

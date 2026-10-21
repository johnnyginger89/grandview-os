import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { guessMapping, normalizePostal, normalizeProvince, planCustomerImport, planSummary, splitFullAddress, type ExistingCustomer } from "./customers";

const CSV = [
  "Customer ID,Display Name,First Name,Last Name,Email,Phone,Mobile,Street,City,Province,Postal Code,Notes,Created Date,Additional Contact Name,Additional Contact Email",
  "101,Sample Person [TEST DATA],Sam,Person,sam@example.com,(604) 555-0101,,1 Example St,Surrey,British Columbia,v3s3m1,Gate code 1234,2024-01-02,Pat Person,pat@example.com",
  "101,Sample Person [TEST DATA],Sam,Person,sam@example.com,(604) 555-0101,,2 Rental Ave,Langley,BC,V2Y 1A1,,2024-01-02,,",
  "102,Example Strata BCS1234 [TEST DATA],,,,604-555-0102,,9 Strata Way,White Rock,BC,,,2024-02-03,,",
  "103,Existing Customer [TEST DATA],,,existing@example.com,,,5 Known Rd,Surrey,BC,,,2024-03-04,,",
  ",,,,,,,,,,,Nothing useful here,,,",
  "104,Robin Example,,,not-an-email,604 555 0104,,,,,,,2024-03-05,,",
].join("\n");

const existing: ExistingCustomer[] = [
  { id: "c-existing", displayName: "Existing Customer", email: "existing@example.com", phone: null, source: null, notes: null, contactEmails: [], contactPhones: [], streets: ["5 Known Road"] },
];

describe("customer import planning", () => {
  const table = parseCsv(CSV);
  const mapping = guessMapping(table);

  it("recognises common Markate column names", () => {
    expect(mapping).toEqual([
      "externalId", "displayName", "firstName", "lastName", "email", "phone", "phone2", "street", "city", "province", "postalCode", "notes", "custom", "contact2Name", "contact2Email",
    ]);
  });

  it("creates, merges and skips correctly", () => {
    const plan = planCustomerImport(table, mapping, existing);
    const s = planSummary(plan);
    expect(s).toMatchObject({ create: 3, merge: 1, skipped: 1, rows: 6 });

    const sam = plan.customers.find((c) => c.customer.importRef === "101")!;
    expect(sam.rowNumbers).toEqual([2, 3]);
    expect(sam.properties.map((p) => p.street)).toEqual(["1 Example St", "2 Rental Ave"]);
    expect(sam.properties[0]).toMatchObject({ province: "BC", postalCode: "V3S 3M1" });
    expect(sam.contacts).toHaveLength(2);
    expect(sam.contacts[0]).toMatchObject({ firstName: "Sam", lastName: "Person", isPrimary: true });
    expect(sam.contacts[1]).toMatchObject({ firstName: "Pat", lastName: "Person", email: "pat@example.com", isPrimary: false });
    expect(sam.customer.customFields).toEqual({ "Created Date": "2024-01-02" });
    expect(sam.customer.tags).toContain("markate-import");

    expect(plan.customers.find((c) => c.customer.importRef === "102")!.customer.type).toBe("strata");

    const merged = plan.customers.find((c) => c.action === "merge")!;
    expect(merged.existingId).toBe("c-existing");
    expect(merged.matchedBy).toBe("email");
    expect(merged.properties).toEqual([]); // "5 Known Rd" = "5 Known Road"
    expect(merged.fill).toEqual({});

    const bad = plan.customers.find((c) => c.customer.importRef === "104")!;
    expect(bad.customer.email).toBeNull();
    expect(bad.customer.notes).toContain("not-an-email");
    expect(bad.warnings[0]).toMatch(/isn't a valid email/);
    // A homeowner listed only by name still gets a first name for the proposal greeting.
    expect(bad.contacts[0]).toMatchObject({ firstName: "Robin", lastName: "Example" });

    expect(plan.skipped).toEqual([{ rowNumber: 6, reason: "No name, email or phone" }]);
  });

  it("matches existing customers by phone when there's no email", () => {
    const plan = planCustomerImport(table, mapping, [{ ...existing[0], id: "c-phone", email: null, phone: "604.555.0102", streets: [] }]);
    const strata = plan.customers.find((c) => c.customer.importRef === "102")!;
    expect(strata).toMatchObject({ action: "merge", existingId: "c-phone", matchedBy: "phone" });
    expect(strata.properties).toHaveLength(1);
  });
});

describe("address helpers", () => {
  it("normalises provinces and postal codes", () => {
    expect(normalizeProvince("British Columbia")).toBe("BC");
    expect(normalizeProvince("ab")).toBe("AB");
    expect(normalizeProvince("")).toBe("BC");
    expect(normalizePostal("v3s3m1")).toBe("V3S 3M1");
    expect(normalizePostal("98225")).toBe("98225");
  });

  it("splits a one-column address", () => {
    expect(splitFullAddress("1 Example St, Surrey, BC V3S 3M1, Canada")).toEqual({ street: "1 Example St", city: "Surrey", province: "BC", postalCode: "V3S 3M1" });
    expect(splitFullAddress("1 Example St")).toMatchObject({ street: "1 Example St", city: null });
  });
});

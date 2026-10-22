import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

type Audit = { action: string; entityId?: string | null; before?: unknown; after?: unknown };
type Reach = { email: string | null; phone: string | null };
const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as Audit[],
  carried: [] as { customerId: string; before: Reach; after: Reach }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: Audit) => void h.audits.push(e) }));
vi.mock("./colour-selections", () => ({
  carryReachToOpenForms: async (_t: unknown, customerId: string, before: Reach, after: Reach) => (h.carried.push({ customerId, before, after }), 0),
}));

const svc = await import("./customers");

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CUSTOMER = uuid(1);
const KIM = uuid(2);
const LEE = uuid(3);
const PAT = uuid(4);
const PROPERTY = uuid(5);
const USER = "owner-1";

const contact = (id: string, extra: Record<string, unknown> = {}) => ({
  id, firstName: "[TEST DATA] Kim", lastName: "Lee", title: null, email: "kim@example.com", phone: "604-555-0100", phone2: null, isPrimary: false, ...extra,
});
const KIM_PRIMARY = contact(KIM, { isPrimary: true });
const LEE_ROW = contact(LEE, { firstName: "[TEST DATA] Lee", email: "lee@example.com", phone: "604-555-0101" });
const PAT_ROW = contact(PAT, { firstName: "[TEST DATA] Pat", email: null, phone: null });

const sets = (table: string) => h.fake.find("update", table).map((c) => ({ set: c.args.set?.[0] as Record<string, unknown>, where: c.args.where?.[0] }));
const customerSets = () => sets("customers").map((s) => s.set);
const contactSets = () => sets("contacts").map((s) => s.set);
const ops = () => h.fake.calls.filter((c) => c.op !== "select").map((c) => `${c.op}:${c.table}`);

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.carried = [];
});

describe("planHandover", () => {
  const customer = { email: "kim@example.com", phone: "604-555-0100" };

  it("gives the customer the new primary's email and phone, and the old primary keeps what it showed", () => {
    const r = svc.planHandover(customer, { email: null, phone: "604-555-0100" }, { email: "lee@example.com", phone: "604-555-0101" });
    expect(r).toEqual({ customer: { email: "lee@example.com", phone: "604-555-0101" }, outgoing: { email: "kim@example.com", phone: "604-555-0100" } });
  });

  it("clears what the new primary doesn't have, so nothing keeps going to the old one", () => {
    expect(svc.planHandover(customer, { email: "kim@example.com", phone: null }, { email: null, phone: "604-555-0101" }).customer).toEqual({ email: null, phone: "604-555-0101" });
  });

  it("keeps the customer's own email and phone when there was no primary before", () => {
    expect(svc.planHandover(customer, null, { email: null, phone: null }).customer).toEqual(customer);
    expect(svc.planHandover(customer, null, { email: "lee@example.com", phone: null }).customer).toEqual({ email: "lee@example.com", phone: "604-555-0100" });
  });

  it("leaves the customer as it is when the last contact goes", () => {
    expect(svc.planHandover(customer, { email: "kim@example.com", phone: "604-555-0100" }, null).customer).toEqual(customer);
  });
});

describe("schemas", () => {
  it("tidy a property: postal code, province and the pre-1990 box", () => {
    const p = svc.propertySchema.parse({ street: " 1 Example St ", postalCode: "v3s0a1", province: "ab", builtBefore1990: true });
    expect(p).toMatchObject({ street: "1 Example St", postalCode: "V3S 0A1", province: "AB", builtBefore1990: true, unit: null, accessNotes: null });
    expect(svc.propertySchema.parse({ street: "1 Example St", province: "" })).toMatchObject({ province: "BC", builtBefore1990: false });
    expect(() => svc.propertySchema.parse({ street: "1 Example St", province: "British Columbia" })).toThrow(/province/);
    expect(() => svc.propertySchema.parse({ street: " " })).toThrow(/Street address is required/);
  });

  it("want a contact to have a name, email or phone, and a real email", () => {
    expect(() => svc.contactSchema.parse({ firstName: " ", email: "" })).toThrow(/Add a name, email or phone number/);
    expect(() => svc.contactSchema.parse({ firstName: "Kim", email: "kim@" })).toThrow(/Check the email address/);
    expect(svc.contactSchema.parse({ email: " KIM@Example.com " })).toMatchObject({ email: "kim@example.com", phone: null, isPrimary: false });
  });
});

describe("updateCustomer", () => {
  const before = { id: CUSTOMER, displayName: "[TEST DATA] Kim Lee", email: "kim@example.com", phone: "604-555-0100" };
  const input = { displayName: "[TEST DATA] Kim Lee", email: "Kim.Lee@example.com", phone: "604-555-0199", type: "residential" as const };

  it("saves the email and phone on the primary contact too, which every sender reads", async () => {
    h.fake.queue({ "select:customers": [[before]], "select:contacts": [[KIM_PRIMARY, LEE_ROW]] });
    await svc.updateCustomer(CUSTOMER, input, USER);
    expect(h.fake.find("select", "customers")[0].args.for).toEqual(["update"]);
    expect(customerSets()[0]).toMatchObject({ displayName: "[TEST DATA] Kim Lee", email: "kim.lee@example.com", phone: "604-555-0199" });
    expect(sets("contacts")).toHaveLength(1);
    expect(contactSets()[0]).toMatchObject({ email: "kim.lee@example.com", phone: "604-555-0199" });
    expect(h.carried).toEqual([{ customerId: CUSTOMER, before: { email: "kim@example.com", phone: "604-555-0100" }, after: { email: "kim.lee@example.com", phone: "604-555-0199" } }]);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "customer.update",
        entityId: CUSTOMER,
        before: expect.objectContaining({ email: "kim@example.com", primaryContact: { id: KIM, email: "kim@example.com", phone: "604-555-0100" } }),
        after: expect.objectContaining({ email: "kim.lee@example.com", primaryContact: { id: KIM, email: "kim.lee@example.com", phone: "604-555-0199" } }),
      }),
    ]);
  });

  it("only changes the customer when it has no primary contact", async () => {
    h.fake.queue({ "select:customers": [[before]], "select:contacts": [[LEE_ROW]] });
    await svc.updateCustomer(CUSTOMER, { ...input, email: "" }, USER);
    expect(customerSets()[0]).toMatchObject({ email: null });
    expect(sets("contacts")).toEqual([]);
  });

  it("says so when the customer is gone", async () => {
    await expect(svc.updateCustomer(CUSTOMER, input, USER)).rejects.toThrow("This customer no longer exists. Refresh the page.");
    expect(h.audits).toEqual([]);
  });
});

describe("addContact", () => {
  const own = { email: "office@example.com", phone: "604-555-0150" };

  it("makes the first contact the primary, even unticked, and keeps the customer's own details it lacks", async () => {
    h.fake.queue({ "select:customers": [[own]], "select:contacts": [[]], "insert:contacts": [[{ ...PAT_ROW, isPrimary: true }]] });
    expect(await svc.addContact(CUSTOMER, { firstName: "[TEST DATA] Pat" }, USER)).toEqual({ id: PAT });
    expect(h.fake.find("insert", "contacts")[0].args.values[0]).toMatchObject({ customerId: CUSTOMER, isPrimary: true, firstName: "[TEST DATA] Pat" });
    expect(customerSets().at(-1)).toMatchObject(own);
    expect(h.audits[0]).toMatchObject({ action: "contact.create", entityId: CUSTOMER, after: { id: PAT, isPrimary: true, previousPrimaryId: null } });
  });

  it("hands over when ticked: the old primary keeps what it showed, the customer takes the new one's", async () => {
    const kimShowingOwn = { ...KIM_PRIMARY, email: null };
    h.fake.queue({ "select:customers": [[{ email: "kim@example.com", phone: "604-555-0100" }]], "select:contacts": [[kimShowingOwn]], "insert:contacts": [[{ ...LEE_ROW, isPrimary: true }]] });
    await svc.addContact(CUSTOMER, { firstName: "[TEST DATA] Lee", email: "lee@example.com", phone: "604-555-0101", isPrimary: true }, USER);
    expect(contactSets()[0]).toMatchObject({ isPrimary: false, email: "kim@example.com", phone: "604-555-0100" });
    expect(contactSets().at(-1)).toMatchObject({ isPrimary: true });
    expect(customerSets().at(-1)).toMatchObject({ email: "lee@example.com", phone: "604-555-0101" });
    expect(h.carried.at(-1)).toMatchObject({ before: { email: "kim@example.com" }, after: { email: "lee@example.com" } });
  });

  it("just adds another contact otherwise", async () => {
    h.fake.queue({ "select:customers": [[own]], "select:contacts": [[KIM_PRIMARY]], "insert:contacts": [[LEE_ROW]] });
    await svc.addContact(CUSTOMER, { firstName: "[TEST DATA] Lee", email: "lee@example.com" }, USER);
    expect(h.fake.find("insert", "contacts")[0].args.values[0]).toMatchObject({ isPrimary: false });
    expect(sets("customers")).toEqual([]);
    expect(sets("contacts")).toEqual([]);
  });
});

describe("updateContact", () => {
  it("keeps the customer in step when the primary's email or phone changes, even to nothing", async () => {
    h.fake.queue({ "select:contacts": [[{ customerId: CUSTOMER }], [KIM_PRIMARY, LEE_ROW]], "select:customers": [[{ email: "kim@example.com", phone: "604-555-0100" }]] });
    expect(await svc.updateContact(KIM, { firstName: "[TEST DATA] Kim", lastName: "Lee", email: "kim.lee@example.com", phone: "" }, USER)).toEqual({ customerId: CUSTOMER });
    expect(h.fake.find("select", "customers")[0].args.for).toEqual(["update"]);
    expect(contactSets()[0]).toMatchObject({ email: "kim.lee@example.com", phone: null, firstName: "[TEST DATA] Kim" });
    expect(contactSets()[0]).not.toHaveProperty("isPrimary");
    expect(customerSets()).toEqual([expect.objectContaining({ email: "kim.lee@example.com", phone: null })]);
    expect(h.carried).toEqual([{ customerId: CUSTOMER, before: { email: "kim@example.com", phone: "604-555-0100" }, after: { email: "kim.lee@example.com", phone: null } }]);
    expect(h.audits[0]).toMatchObject({ action: "contact.update", entityId: CUSTOMER, before: { id: KIM, email: "kim@example.com" }, after: { id: KIM, email: "kim.lee@example.com" } });
  });

  it("leaves the customer alone for any other contact", async () => {
    h.fake.queue({ "select:contacts": [[{ customerId: CUSTOMER }], [KIM_PRIMARY, LEE_ROW]], "select:customers": [[{ email: "kim@example.com", phone: null }]] });
    await svc.updateContact(LEE, { firstName: "[TEST DATA] Lee", email: "lee2@example.com" }, USER);
    expect(sets("customers")).toEqual([]);
    expect(h.carried).toEqual([]);
  });

  it("says so when the contact is gone", async () => {
    await expect(svc.updateContact(LEE, { firstName: "Lee" }, USER)).rejects.toThrow("This contact no longer exists. Refresh the page.");
  });
});

describe("setPrimaryContact", () => {
  it("switches the primary and points the customer's email and phone at the new one", async () => {
    h.fake.queue({ "select:contacts": [[{ customerId: CUSTOMER }], [KIM_PRIMARY, LEE_ROW]], "select:customers": [[{ email: "kim@example.com", phone: "604-555-0100" }]] });
    await svc.setPrimaryContact(LEE, USER);
    expect(contactSets()).toEqual([
      expect.objectContaining({ isPrimary: false, email: "kim@example.com", phone: "604-555-0100" }),
      { isPrimary: false },
      expect.objectContaining({ isPrimary: true }),
    ]);
    expect(customerSets()).toEqual([expect.objectContaining({ email: "lee@example.com", phone: "604-555-0101" })]);
    expect(h.audits[0]).toMatchObject({ action: "contact.primary", before: { primaryContactId: KIM, email: "kim@example.com" }, after: { primaryContactId: LEE, email: "lee@example.com" } });
  });

  it("does nothing for the contact that already is the primary", async () => {
    h.fake.queue({ "select:contacts": [[{ customerId: CUSTOMER }], [KIM_PRIMARY, LEE_ROW]], "select:customers": [[{ email: "kim@example.com", phone: null }]] });
    await svc.setPrimaryContact(KIM, USER);
    expect(ops()).toEqual([]);
    expect(h.audits).toEqual([]);
  });
});

describe("removeContact", () => {
  const locked = () => ({ "select:customers": [[{ email: "kim@example.com", phone: "604-555-0100" }]] });

  it("hands the primary over to the chosen contact before removing it", async () => {
    h.fake.queue({ "select:contacts": [[{ customerId: CUSTOMER }], [KIM_PRIMARY, LEE_ROW, PAT_ROW]], ...locked() });
    await svc.removeContact(KIM, { newPrimaryId: PAT }, USER);
    expect(ops()).toEqual(["update:contacts", "update:contacts", "update:customers", "delete:contacts"]);
    expect(contactSets()).toEqual([{ isPrimary: false }, expect.objectContaining({ isPrimary: true })]);
    // Pat has no email or phone: nothing keeps going to Kim, who is gone.
    expect(customerSets()).toEqual([expect.objectContaining({ email: null, phone: null })]);
    expect(h.audits[0]).toMatchObject({ action: "contact.remove", entityId: CUSTOMER, before: { id: KIM, isPrimary: true }, after: { primaryContactId: PAT, email: null } });
  });

  it("picks the oldest other contact when nobody was chosen", async () => {
    h.fake.queue({ "select:contacts": [[{ customerId: CUSTOMER }], [KIM_PRIMARY, LEE_ROW, PAT_ROW]], ...locked() });
    await svc.removeContact(KIM, {}, USER);
    expect(customerSets()).toEqual([expect.objectContaining({ email: "lee@example.com", phone: "604-555-0101" })]);
    expect(h.audits[0].after).toMatchObject({ primaryContactId: LEE });
  });

  it("refuses a new primary who isn't one of the customer's contacts", async () => {
    h.fake.queue({ "select:contacts": [[{ customerId: CUSTOMER }], [KIM_PRIMARY, LEE_ROW]], ...locked() });
    await expect(svc.removeContact(KIM, { newPrimaryId: uuid(99) }, USER)).rejects.toThrow(/isn't on this customer any more/);
    await expect(svc.removeContact(KIM, { newPrimaryId: "not-an-id" }, USER)).rejects.toThrow();
    expect(h.fake.find("delete", "contacts")).toEqual([]);
  });

  it("keeps the customer's email and phone when the only contact goes", async () => {
    h.fake.queue({ "select:contacts": [[{ customerId: CUSTOMER }], [KIM_PRIMARY]], ...locked() });
    await svc.removeContact(KIM, {}, USER);
    expect(customerSets()).toEqual([expect.objectContaining({ email: "kim@example.com", phone: "604-555-0100" })]);
    expect(sets("contacts")).toEqual([]);
    expect(h.fake.find("delete", "contacts")).toHaveLength(1);
  });

  it("just removes a contact that isn't the primary", async () => {
    h.fake.queue({ "select:contacts": [[{ customerId: CUSTOMER }], [KIM_PRIMARY, LEE_ROW]], ...locked() });
    await svc.removeContact(LEE, { newPrimaryId: null }, USER);
    expect(ops()).toEqual(["delete:contacts"]);
    expect(h.audits[0]).toMatchObject({ action: "contact.remove", before: { id: LEE }, after: null });
  });
});

describe("properties", () => {
  const row = { id: PROPERTY, customerId: CUSTOMER, street: "1 Example St", unit: null, city: "Surrey", province: "BC", postalCode: "V3S 0A1", accessNotes: null, builtBefore1990: null };

  it("updateProperty saves every field, the pre-1990 box included, with before and after", async () => {
    h.fake.queue({ "select:properties": [[row]] });
    const input = { street: "1 Example St", unit: "4", city: "Surrey", province: "BC", postalCode: "v3s 0a1", accessNotes: "Lockbox 2468 by the side door", builtBefore1990: true };
    expect(await svc.updateProperty(PROPERTY, input, USER)).toEqual({ customerId: CUSTOMER });
    expect(h.fake.find("select", "properties")[0].args.for).toEqual(["update"]);
    expect(sets("properties")[0].set).toMatchObject({ unit: "4", postalCode: "V3S 0A1", accessNotes: "Lockbox 2468 by the side door", builtBefore1990: true });
    expect(h.audits[0]).toMatchObject({ action: "property.update", entityId: CUSTOMER, before: { id: PROPERTY, builtBefore1990: null }, after: { id: PROPERTY, builtBefore1990: true } });
  });

  it("updateProperty says so when the property is gone", async () => {
    await expect(svc.updateProperty(PROPERTY, { street: "1 Example St" }, USER)).rejects.toThrow("This property no longer exists. Refresh the page.");
  });

  it("removeProperty refuses while an estimate, a job or a lead uses the property", async () => {
    h.fake.queue({ "select:properties": [[row]], "select:estimates": [[{ n: 1042 }, { n: 1043 }]], "select:projects": [[{ n: 3018 }]], "select:opportunities": [[]] });
    await expect(svc.removeProperty(PROPERTY, USER)).rejects.toThrow("This property is used by estimates #1042 and #1043 and job #3018, so it can't be removed. You can edit it instead.");
    expect(h.fake.find("delete", "properties")).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("removeProperty removes an unused property and audits what it was", async () => {
    h.fake.queue({ "select:properties": [[row]] });
    expect(await svc.removeProperty(PROPERTY, USER)).toEqual({ customerId: CUSTOMER });
    expect(h.fake.find("delete", "properties")).toHaveLength(1);
    expect(h.audits).toEqual([expect.objectContaining({ action: "property.remove", entityId: CUSTOMER, before: row })]);
  });

  it("propertyInUseMessage names what uses it, briefly", () => {
    expect(svc.propertyInUseMessage({ estimates: [], jobs: [], leads: [] })).toBeNull();
    expect(svc.propertyInUseMessage({ estimates: [], jobs: [], leads: [1001] })).toBe("This property is used by lead #1001, so it can't be removed. You can edit it instead.");
    expect(svc.propertyInUseMessage({ estimates: [1, 2, 3, 4], jobs: [3018, 3019], leads: [1001] })).toBe(
      "This property is used by 4 estimates, jobs #3018 and #3019 and lead #1001, so it can't be removed. You can edit it instead.",
    );
  });
});

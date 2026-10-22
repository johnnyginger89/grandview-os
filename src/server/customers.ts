import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, contacts, customers, estimates, opportunities, projects, properties } from "@/db/schema";
import { PROPERTY_TYPES } from "@/db/schema/crm";
import { customerReach, type Reach } from "@/lib/customer-reach";
import { normalizePostal } from "@/lib/import/customers";
import { audit } from "./audit";
import { carryReachToOpenForms } from "./colour-selections";

/*
 * Customers, their contacts and their properties. The primary contact's email and phone
 * are the customer's (src/lib/customer-reach.ts): every change here keeps customers.email
 * and customers.phone in step with them and carries a correction over to open colour
 * forms. A customer with contacts always has exactly one primary; contact changes lock
 * the customer row first so two edits can't race to pick one. Callers check customers.write.
 */

export class CustomerError extends Error {
  readonly expose = true;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const CUSTOMER_GONE = "This customer no longer exists. Refresh the page.";
const CONTACT_GONE = "This contact no longer exists. Refresh the page.";
const PROPERTY_GONE = "This property no longer exists. Refresh the page.";

const s = z.string().trim().max(500).optional().transform((v) => (v ? v : null));
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .refine((v) => !v || z.string().email().safeParse(v).success, "Check the email address")
  .optional()
  .transform((v) => v || null);

export const customerSchema = z.object({
  type: z.enum(["residential", "commercial", "strata"]).default("residential"),
  displayName: z.string().trim().min(1, "Name is required").max(200),
  email,
  phone: s,
  source: s,
  tags: z.string().optional().transform((v) => (v ? v.split(",").map((t) => t.trim()).filter(Boolean) : [])),
  notes: z.string().max(5000).optional().transform((v) => v || null),
});

export const contactSchema = z
  .object({
    firstName: z.string().trim().max(100).default(""),
    lastName: z.string().trim().max(100).default(""),
    title: s,
    email,
    phone: s,
    phone2: s,
    isPrimary: z.boolean().default(false),
  })
  .refine((c) => c.firstName || c.lastName || c.email || c.phone || c.phone2, "Add a name, email or phone number.");

export const propertySchema = z.object({
  label: s,
  street: z.string().trim().min(1, "Street address is required").max(300),
  unit: s,
  city: s,
  province: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => !v || /^[A-Z]{2}$/.test(v), "Pick a province")
    .optional()
    .transform((v) => v || "BC"),
  postalCode: s.transform((v) => normalizePostal(v)),
  propertyType: z.enum(PROPERTY_TYPES).optional().nullable(),
  strataPlan: s,
  accessNotes: z.string().trim().max(1000).optional().transform((v) => v || null),
  builtBefore1990: z.boolean().default(false),
});

export const removeContactSchema = z.object({ newPrimaryId: z.string().uuid().nullish() });

const contactColumns = {
  id: contacts.id,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  title: contacts.title,
  email: contacts.email,
  phone: contacts.phone,
  phone2: contacts.phone2,
  isPrimary: contacts.isPrimary,
};
type ContactRow = { id: string; firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null; phone2: string | null; isPrimary: boolean };

const colourNote = (n: number) => (n ? { colourFormsUpdated: n } : {});

/** Locks the customer row, so changes to one customer's contacts happen one at a time. */
async function lockCustomer(tx: Tx, customerId: string): Promise<Reach> {
  const [c] = await tx.select({ email: customers.email, phone: customers.phone }).from(customers).where(eq(customers.id, customerId)).for("update");
  if (!c) throw new CustomerError(CUSTOMER_GONE);
  return c;
}

/** Oldest first: the first of the others takes over when the primary is removed. */
function contactsOf(tx: Tx, customerId: string): Promise<ContactRow[]> {
  return tx.select(contactColumns).from(contacts).where(eq(contacts.customerId, customerId)).orderBy(asc(contacts.createdAt), asc(contacts.id));
}

async function customerOfContact(tx: Tx, contactId: string): Promise<string> {
  const [row] = await tx.select({ customerId: contacts.customerId }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!row?.customerId) throw new CustomerError(CONTACT_GONE);
  return row.customerId;
}

/**
 * What changes when the primary contact goes from `outgoing` to `incoming` (null: none).
 * The outgoing contact keeps what it showed (its own email and phone, else the customer's),
 * and the customer takes the incoming contact's. A field the incoming contact doesn't have
 * is cleared, so nothing keeps going to the old primary, unless there was no primary before:
 * then it is the customer's own and stays. With no contacts left the customer keeps its own.
 */
export function planHandover(customer: Reach, outgoing: Reach | null, incoming: Reach | null): { customer: Reach; outgoing: Reach | null } {
  const shown = outgoing ? customerReach(customer, outgoing) : null;
  if (!incoming) return { customer: customerReach(customer), outgoing: shown };
  const own = outgoing ? null : customerReach(customer);
  const next = customerReach(null, incoming);
  return { customer: { email: next.email ?? own?.email ?? null, phone: next.phone ?? own?.phone ?? null }, outgoing: shown };
}

async function handOver(tx: Tx, customerId: string, customer: Reach, outgoing: ContactRow | null, incoming: ContactRow | null, outgoingStays: boolean) {
  const plan = planHandover(customer, outgoing, incoming);
  const now = new Date();
  if (outgoing && outgoingStays && plan.outgoing) {
    await tx.update(contacts).set({ isPrimary: false, email: plan.outgoing.email, phone: plan.outgoing.phone, updatedAt: now }).where(eq(contacts.id, outgoing.id));
  }
  if (incoming) {
    await tx.update(contacts).set({ isPrimary: false }).where(and(eq(contacts.customerId, customerId), ne(contacts.id, incoming.id), eq(contacts.isPrimary, true)));
    await tx.update(contacts).set({ isPrimary: true, updatedAt: now }).where(eq(contacts.id, incoming.id));
  }
  await tx.update(customers).set({ email: plan.customer.email, phone: plan.customer.phone, updatedAt: now }).where(eq(customers.id, customerId));
  const before = customerReach(customer, outgoing);
  const after = customerReach(plan.customer, incoming);
  return { before, after, colourForms: await carryReachToOpenForms(tx, customerId, before, after) };
}

export async function createCustomer(input: z.input<typeof customerSchema>, contact: z.input<typeof contactSchema> | null, property: z.input<typeof propertySchema> | null, userId: string) {
  const c = customerSchema.parse(input);
  const person = contact && [contact.firstName, contact.lastName, contact.email, contact.phone].some((v) => v?.trim()) ? contactSchema.parse(contact) : null;
  const place = property?.street ? propertySchema.parse(property) : null;
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(customers).values({ ...c, createdBy: userId }).returning();
    if (person) await tx.insert(contacts).values({ ...person, customerId: row.id, isPrimary: true });
    if (place) await tx.insert(properties).values({ ...place, customerId: row.id });
    await tx.insert(activities).values({ customerId: row.id, type: "system", body: "Customer created", createdBy: userId });
    await audit({ actorId: userId, action: "customer.create", entityType: "customer", entityId: row.id, after: c }, tx);
    return row;
  });
}

/** "Edit customer". Its email and phone are the primary contact's, so they are saved there too. */
export async function updateCustomer(id: string, input: z.input<typeof customerSchema>, userId: string) {
  const c = customerSchema.parse(input);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(customers).where(eq(customers.id, id)).for("update");
    if (!before) throw new CustomerError(CUSTOMER_GONE);
    const primary = (await contactsOf(tx, id)).find((p) => p.isPrimary) ?? null;
    const now = new Date();
    await tx.update(customers).set({ ...c, updatedAt: now }).where(eq(customers.id, id));
    if (primary) await tx.update(contacts).set({ email: c.email, phone: c.phone, updatedAt: now }).where(eq(contacts.id, primary.id));
    const colourForms = await carryReachToOpenForms(tx, id, customerReach(before, primary), customerReach(c));
    await audit(
      {
        actorId: userId,
        action: "customer.update",
        entityType: "customer",
        entityId: id,
        before: { ...before, primaryContact: primary && { id: primary.id, email: primary.email, phone: primary.phone } },
        after: { ...c, primaryContact: primary && { id: primary.id, email: c.email, phone: c.phone }, ...colourNote(colourForms) },
      },
      tx,
    );
  });
}

export async function addContact(customerId: string, input: z.input<typeof contactSchema>, userId: string): Promise<{ id: string }> {
  const c = contactSchema.parse(input);
  const values = { firstName: c.firstName, lastName: c.lastName, title: c.title, email: c.email, phone: c.phone, phone2: c.phone2 };
  return db.transaction(async (tx) => {
    const customer = await lockCustomer(tx, customerId);
    const outgoing = (await contactsOf(tx, customerId)).find((p) => p.isPrimary) ?? null;
    // A customer with contacts always has a primary, so the first one is it.
    const primary = c.isPrimary || !outgoing;
    const [row] = await tx.insert(contacts).values({ ...values, customerId, isPrimary: primary }).returning(contactColumns);
    const r = primary ? await handOver(tx, customerId, customer, outgoing, row, true) : null;
    await audit(
      {
        actorId: userId,
        action: "contact.create",
        entityType: "customer",
        entityId: customerId,
        after: { id: row.id, ...values, isPrimary: primary, ...(r ? { previousPrimaryId: outgoing?.id ?? null, customerEmail: r.after.email, customerPhone: r.after.phone, ...colourNote(r.colourForms) } : {}) },
      },
      tx,
    );
    return { id: row.id };
  });
}

export async function updateContact(contactId: string, input: z.input<typeof contactSchema>, userId: string): Promise<{ customerId: string }> {
  const c = contactSchema.parse(input);
  const values = { firstName: c.firstName, lastName: c.lastName, title: c.title, email: c.email, phone: c.phone, phone2: c.phone2 };
  return db.transaction(async (tx) => {
    const customerId = await customerOfContact(tx, contactId);
    const customer = await lockCustomer(tx, customerId);
    const before = (await contactsOf(tx, customerId)).find((p) => p.id === contactId);
    if (!before) throw new CustomerError(CONTACT_GONE);
    const now = new Date();
    await tx.update(contacts).set({ ...values, updatedAt: now }).where(eq(contacts.id, contactId));
    let colourForms = 0;
    if (before.isPrimary) {
      // The form showed the primary with the customer's email and phone, so what was saved is the customer's.
      await tx.update(customers).set({ email: values.email, phone: values.phone, updatedAt: now }).where(eq(customers.id, customerId));
      colourForms = await carryReachToOpenForms(tx, customerId, customerReach(customer, before), customerReach(values));
    }
    await audit({ actorId: userId, action: "contact.update", entityType: "customer", entityId: customerId, before, after: { id: contactId, ...values, ...colourNote(colourForms) } }, tx);
    return { customerId };
  });
}

export async function setPrimaryContact(contactId: string, userId: string): Promise<{ customerId: string }> {
  return db.transaction(async (tx) => {
    const customerId = await customerOfContact(tx, contactId);
    const customer = await lockCustomer(tx, customerId);
    const people = await contactsOf(tx, customerId);
    const incoming = people.find((p) => p.id === contactId);
    if (!incoming) throw new CustomerError(CONTACT_GONE);
    if (incoming.isPrimary) return { customerId };
    const outgoing = people.find((p) => p.isPrimary) ?? null;
    const r = await handOver(tx, customerId, customer, outgoing, incoming, true);
    await audit(
      {
        actorId: userId,
        action: "contact.primary",
        entityType: "customer",
        entityId: customerId,
        before: { primaryContactId: outgoing?.id ?? null, ...r.before },
        after: { primaryContactId: incoming.id, ...r.after, ...colourNote(r.colourForms) },
      },
      tx,
    );
    return { customerId };
  });
}

/** Removing the primary hands over to `newPrimaryId`, else to the oldest of the others. */
export async function removeContact(contactId: string, raw: z.input<typeof removeContactSchema>, userId: string): Promise<{ customerId: string }> {
  const { newPrimaryId } = removeContactSchema.parse(raw);
  return db.transaction(async (tx) => {
    const customerId = await customerOfContact(tx, contactId);
    const customer = await lockCustomer(tx, customerId);
    const people = await contactsOf(tx, customerId);
    const gone = people.find((p) => p.id === contactId);
    if (!gone) throw new CustomerError(CONTACT_GONE);
    const rest = people.filter((p) => p.id !== contactId);
    let after: Record<string, unknown> | null = null;
    if (gone.isPrimary) {
      const next = newPrimaryId ? rest.find((p) => p.id === newPrimaryId) : rest[0];
      if (newPrimaryId && !next) throw new CustomerError("That contact isn't on this customer any more. Refresh the page and pick again.");
      // Hand over before the delete, so the customer is never left with contacts but no primary.
      const r = await handOver(tx, customerId, customer, gone, next ?? null, false);
      after = { primaryContactId: next?.id ?? null, ...r.after, ...colourNote(r.colourForms) };
    }
    await tx.delete(contacts).where(eq(contacts.id, contactId));
    await audit({ actorId: userId, action: "contact.remove", entityType: "customer", entityId: customerId, before: gone, after }, tx);
    return { customerId };
  });
}

export async function addProperty(customerId: string, input: z.input<typeof propertySchema>, userId: string) {
  const p = propertySchema.parse(input);
  const [row] = await db.insert(properties).values({ ...p, customerId }).returning();
  await audit({ actorId: userId, action: "property.create", entityType: "customer", entityId: customerId, after: { id: row.id, ...p } });
  return row;
}

export async function updateProperty(propertyId: string, input: z.input<typeof propertySchema>, userId: string): Promise<{ customerId: string }> {
  const p = propertySchema.parse(input);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(properties).where(eq(properties.id, propertyId)).for("update");
    if (!before) throw new CustomerError(PROPERTY_GONE);
    await tx.update(properties).set({ ...p, updatedAt: new Date() }).where(eq(properties.id, propertyId));
    await audit({ actorId: userId, action: "property.update", entityType: "customer", entityId: before.customerId, before, after: { id: propertyId, ...p } }, tx);
    return { customerId: before.customerId };
  });
}

const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Null when nothing uses the property. Estimates, jobs and leads would silently lose their address. */
export function propertyInUseMessage(used: { estimates: number[]; jobs: number[]; leads: number[] }): string | null {
  const part = (ns: number[], one: string, many: string) =>
    !ns.length ? null : ns.length > 3 ? `${ns.length} ${many}` : `${ns.length === 1 ? one : many} ${listOf(ns.map((n) => `#${n}`))}`;
  const parts = [part(used.estimates, "estimate", "estimates"), part(used.jobs, "job", "jobs"), part(used.leads, "lead", "leads")].filter((x): x is string => !!x);
  return parts.length ? `This property is used by ${listOf(parts)}, so it can't be removed. You can edit it instead.` : null;
}

const numbers = (rows: { n: number | null }[]) => rows.map((r) => r.n).filter((n): n is number => n !== null);

export async function removeProperty(propertyId: string, userId: string): Promise<{ customerId: string }> {
  return db.transaction(async (tx) => {
    // The row lock also holds back anything about to start using the property until it's gone.
    const [before] = await tx.select().from(properties).where(eq(properties.id, propertyId)).for("update");
    if (!before) throw new CustomerError(PROPERTY_GONE);
    const used = {
      estimates: numbers(await tx.select({ n: estimates.number }).from(estimates).where(eq(estimates.propertyId, propertyId)).orderBy(asc(estimates.number))),
      jobs: numbers(await tx.select({ n: projects.number }).from(projects).where(eq(projects.propertyId, propertyId)).orderBy(asc(projects.number))),
      leads: numbers(await tx.select({ n: opportunities.number }).from(opportunities).where(eq(opportunities.propertyId, propertyId)).orderBy(asc(opportunities.number))),
    };
    const inUse = propertyInUseMessage(used);
    if (inUse) throw new CustomerError(inUse);
    await tx.delete(properties).where(eq(properties.id, propertyId));
    await audit({ actorId: userId, action: "property.remove", entityType: "customer", entityId: before.customerId, before }, tx);
    return { customerId: before.customerId };
  });
}

import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, contacts, customers, properties } from "@/db/schema";
import { audit } from "./audit";

const s = z.string().trim().max(500).optional().transform((v) => (v ? v : null));

export const customerSchema = z.object({
  type: z.enum(["residential", "commercial", "strata"]).default("residential"),
  displayName: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")).transform((v) => v || null),
  phone: s,
  source: s,
  tags: z.string().optional().transform((v) => (v ? v.split(",").map((t) => t.trim()).filter(Boolean) : [])),
  notes: z.string().max(5000).optional().transform((v) => v || null),
});

export const contactSchema = z.object({
  firstName: z.string().trim().max(100).default(""),
  lastName: z.string().trim().max(100).default(""),
  title: s,
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")).transform((v) => v || null),
  phone: s,
  isPrimary: z.boolean().default(false),
});

export const propertySchema = z.object({
  label: s,
  street: z.string().trim().min(1, "Street address is required").max(300),
  unit: s,
  city: s,
  province: z.string().trim().max(2).default("BC"),
  postalCode: s,
  propertyType: z.enum(["detached", "townhouse", "condo", "strata_complex", "commercial", "other"]).optional().nullable(),
  strataPlan: s,
  accessNotes: s,
});

export async function createCustomer(input: z.input<typeof customerSchema>, contact: z.input<typeof contactSchema> | null, property: z.input<typeof propertySchema> | null, userId: string) {
  const c = customerSchema.parse(input);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(customers).values({ ...c, createdBy: userId }).returning();
    if (contact && (contact.firstName || contact.lastName || contact.email || contact.phone)) {
      await tx.insert(contacts).values({ ...contactSchema.parse(contact), customerId: row.id, isPrimary: true });
    }
    if (property?.street) await tx.insert(properties).values({ ...propertySchema.parse(property), customerId: row.id });
    await tx.insert(activities).values({ customerId: row.id, type: "system", body: "Customer created", createdBy: userId });
    await audit({ actorId: userId, action: "customer.create", entityType: "customer", entityId: row.id, after: c }, tx);
    return row;
  });
}

export async function updateCustomer(id: string, input: z.input<typeof customerSchema>, userId: string) {
  const c = customerSchema.parse(input);
  const before = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  if (!before) throw new Error("Customer not found");
  await db.update(customers).set({ ...c, updatedAt: new Date() }).where(eq(customers.id, id));
  await audit({ actorId: userId, action: "customer.update", entityType: "customer", entityId: id, before, after: c });
}

export async function addContact(customerId: string, input: z.input<typeof contactSchema>, userId: string) {
  const c = contactSchema.parse(input);
  await db.transaction(async (tx) => {
    if (c.isPrimary) await tx.update(contacts).set({ isPrimary: false }).where(eq(contacts.customerId, customerId));
    await tx.insert(contacts).values({ ...c, customerId });
    await audit({ actorId: userId, action: "contact.create", entityType: "customer", entityId: customerId, after: c }, tx);
  });
}

export async function addProperty(customerId: string, input: z.input<typeof propertySchema>, userId: string) {
  const p = propertySchema.parse(input);
  const [row] = await db.insert(properties).values({ ...p, customerId }).returning();
  await audit({ actorId: userId, action: "property.create", entityType: "customer", entityId: customerId, after: p });
  return row;
}

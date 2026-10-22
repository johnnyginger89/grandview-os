"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import {
  addContact,
  addProperty,
  createCustomer,
  removeContact,
  removeProperty,
  setPrimaryContact,
  updateContact,
  updateCustomer,
  updateProperty,
} from "@/server/customers";

export type FormState = { ok: boolean; error?: string } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const uuid = z.string().uuid();

const message = safeErrorMessage;

const contactFields = (f: FormData) => ({
  firstName: str(f, "firstName"),
  lastName: str(f, "lastName"),
  title: str(f, "title"),
  email: str(f, "email"),
  phone: str(f, "phone"),
  phone2: str(f, "phone2"),
  isPrimary: f.get("isPrimary") === "on",
});

const propertyFields = (f: FormData) => ({
  label: str(f, "label"),
  street: str(f, "street"),
  unit: str(f, "unit"),
  city: str(f, "city"),
  province: str(f, "province"),
  postalCode: str(f, "postalCode"),
  propertyType: (str(f, "propertyType") || null) as "detached" | null,
  strataPlan: str(f, "strataPlan"),
  accessNotes: str(f, "accessNotes"),
  builtBefore1990: f.get("builtBefore1990") === "on",
});

export async function createCustomerAction(_: FormState, f: FormData): Promise<FormState> {
  let id: string;
  try {
    const user = await assertPermission("customers.write");
    const row = await createCustomer(
      { type: str(f, "type") as "residential", displayName: str(f, "displayName"), email: str(f, "email"), phone: str(f, "phone"), source: str(f, "source"), tags: str(f, "tags"), notes: str(f, "notes") },
      { firstName: str(f, "firstName"), lastName: str(f, "lastName"), email: str(f, "email"), phone: str(f, "phone"), title: str(f, "title") },
      str(f, "street") ? { street: str(f, "street"), unit: str(f, "unit"), city: str(f, "city"), postalCode: str(f, "postalCode"), builtBefore1990: f.get("builtBefore1990") === "on" } : null,
      user.id,
    );
    id = row.id;
  } catch (e) {
    return { ok: false, error: message(e) };
  }
  redirect(`/customers/${id}`);
}

export async function updateCustomerAction(id: string, _: FormState, f: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    await updateCustomer(uuid.parse(id), { type: str(f, "type") as "residential", displayName: str(f, "displayName"), email: str(f, "email"), phone: str(f, "phone"), source: str(f, "source"), tags: str(f, "tags"), notes: str(f, "notes") }, user.id);
    revalidatePath(`/customers/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function addContactAction(customerId: string, _: FormState, f: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    await addContact(uuid.parse(customerId), contactFields(f), user.id);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function updateContactAction(contactId: string, _: FormState, f: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    const { customerId } = await updateContact(uuid.parse(contactId), contactFields(f), user.id);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function setPrimaryContactAction(contactId: string): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    const { customerId } = await setPrimaryContact(uuid.parse(contactId), user.id);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function removeContactAction(contactId: string, _: FormState, f: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    const { customerId } = await removeContact(uuid.parse(contactId), { newPrimaryId: str(f, "newPrimaryId") || null }, user.id);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function addPropertyAction(customerId: string, _: FormState, f: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    await addProperty(uuid.parse(customerId), propertyFields(f), user.id);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function updatePropertyAction(propertyId: string, _: FormState, f: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    const { customerId } = await updateProperty(uuid.parse(propertyId), propertyFields(f), user.id);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function removePropertyAction(propertyId: string): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    const { customerId } = await removeProperty(uuid.parse(propertyId), user.id);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { addContact, addProperty, createCustomer, updateCustomer } from "@/server/customers";

export type FormState = { ok: boolean; error?: string } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

const message = safeErrorMessage;

export async function createCustomerAction(_: FormState, f: FormData): Promise<FormState> {
  let id: string;
  try {
    const user = await assertPermission("customers.write");
    const row = await createCustomer(
      { type: str(f, "type") as "residential", displayName: str(f, "displayName"), email: str(f, "email"), phone: str(f, "phone"), source: str(f, "source"), tags: str(f, "tags"), notes: str(f, "notes") },
      { firstName: str(f, "firstName"), lastName: str(f, "lastName"), email: str(f, "email"), phone: str(f, "phone"), title: str(f, "title") },
      str(f, "street") ? { street: str(f, "street"), unit: str(f, "unit"), city: str(f, "city"), postalCode: str(f, "postalCode") } : null,
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
    await updateCustomer(z.string().uuid().parse(id), { type: str(f, "type") as "residential", displayName: str(f, "displayName"), email: str(f, "email"), phone: str(f, "phone"), source: str(f, "source"), tags: str(f, "tags"), notes: str(f, "notes") }, user.id);
    revalidatePath(`/customers/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function addContactAction(customerId: string, _: FormState, f: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    await addContact(z.string().uuid().parse(customerId), { firstName: str(f, "firstName"), lastName: str(f, "lastName"), title: str(f, "title"), email: str(f, "email"), phone: str(f, "phone"), isPrimary: f.get("isPrimary") === "on" }, user.id);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function addPropertyAction(customerId: string, _: FormState, f: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("customers.write");
    await addProperty(z.string().uuid().parse(customerId), {
      label: str(f, "label"), street: str(f, "street"), unit: str(f, "unit"), city: str(f, "city"), postalCode: str(f, "postalCode"),
      propertyType: (str(f, "propertyType") || null) as "detached" | null, strataPlan: str(f, "strataPlan"), accessNotes: str(f, "accessNotes"),
    }, user.id);
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

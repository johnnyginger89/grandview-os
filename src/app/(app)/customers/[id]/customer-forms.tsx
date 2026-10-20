"use client";
import { useActionState, useState } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { addContactAction, addPropertyAction, updateCustomerAction, type FormState } from "../actions";

function useClosingForm(action: (s: FormState, f: FormData) => Promise<FormState>) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: FormState, f: FormData) => {
    const r = await action(prev, f);
    if (r?.ok) setOpen(false);
    return r;
  }, null);
  return { open, setOpen, state, formAction, pending };
}

export function AddContactForm({ customerId }: { customerId: string }) {
  const f = useClosingForm(addContactAction.bind(null, customerId));
  if (!f.open) return <Button size="sm" variant="ghost" onClick={() => f.setOpen(true)}>+ Add contact</Button>;
  return (
    <form action={f.formAction} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input name="firstName" placeholder="First name" aria-label="First name" />
        <Input name="lastName" placeholder="Last name" aria-label="Last name" />
      </div>
      <Input name="title" placeholder="Title / role" aria-label="Title" />
      <Input name="email" type="email" placeholder="Email" aria-label="Email" />
      <Input name="phone" type="tel" placeholder="Phone" aria-label="Phone" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPrimary" /> Primary contact</label>
      <FormError message={f.state?.error} />
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={f.pending}>Save</Button><Button size="sm" variant="ghost" onClick={() => f.setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function AddPropertyForm({ customerId }: { customerId: string }) {
  const f = useClosingForm(addPropertyAction.bind(null, customerId));
  if (!f.open) return <Button size="sm" variant="ghost" onClick={() => f.setOpen(true)}>+ Add property</Button>;
  return (
    <form action={f.formAction} className="space-y-2">
      <Input name="label" placeholder="Label (optional), e.g. Rental, Building A" aria-label="Label" />
      <Input name="street" placeholder="Street address" aria-label="Street" required />
      <div className="grid grid-cols-2 gap-2">
        <Input name="unit" placeholder="Unit" aria-label="Unit" />
        <Input name="city" placeholder="City" aria-label="City" />
      </div>
      <Input name="postalCode" placeholder="Postal code" aria-label="Postal code" />
      <Select name="propertyType" aria-label="Property type" defaultValue="">
        <option value="">Property type…</option><option value="detached">Detached house</option><option value="townhouse">Townhouse</option>
        <option value="condo">Condo / apartment</option><option value="strata_complex">Strata complex</option><option value="commercial">Commercial</option>
      </Select>
      <Input name="strataPlan" placeholder="Strata plan # (optional)" aria-label="Strata plan" />
      <Textarea name="accessNotes" placeholder="Access notes: gate code, parking, pets…" aria-label="Access notes" rows={2} />
      <FormError message={f.state?.error} />
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={f.pending}>Save</Button><Button size="sm" variant="ghost" onClick={() => f.setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function EditCustomer({ customer }: { customer: { id: string; type: string; displayName: string; email: string; phone: string; source: string; tags: string; notes: string } }) {
  const f = useClosingForm(updateCustomerAction.bind(null, customer.id));
  if (!f.open) return <Button variant="secondary" onClick={() => f.setOpen(true)}>Edit</Button>;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16">
      <form action={f.formAction} className="w-full max-w-lg space-y-3 rounded-lg bg-surface p-5 shadow-lg">
        <h2 className="font-semibold">Edit customer</h2>
        <Field label="Name"><Input name="displayName" defaultValue={customer.displayName} required /></Field>
        <Field label="Type"><Select name="type" defaultValue={customer.type}><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="strata">Strata</option></Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Input name="email" type="email" defaultValue={customer.email} /></Field>
          <Field label="Phone"><Input name="phone" defaultValue={customer.phone} /></Field>
        </div>
        <Field label="Source"><Input name="source" defaultValue={customer.source} /></Field>
        <Field label="Tags"><Input name="tags" defaultValue={customer.tags} /></Field>
        <Field label="Notes"><Textarea name="notes" defaultValue={customer.notes} /></Field>
        <FormError message={f.state?.error} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => f.setOpen(false)}>Cancel</Button><Button type="submit" disabled={f.pending}>Save</Button></div>
      </form>
    </div>
  );
}

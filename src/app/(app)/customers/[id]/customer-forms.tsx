"use client";
import { useActionState, useId, useState, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { submitWith } from "@/components/submit";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import {
  addContactAction,
  addPropertyAction,
  removeContactAction,
  removePropertyAction,
  setPrimaryContactAction,
  updateContactAction,
  updateCustomerAction,
  updatePropertyAction,
  type FormState,
} from "../actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export interface ContactDTO {
  id: string;
  /** "Kim Lee", or whatever there is to go by. */
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  /** For the primary contact: the customer's email and phone (what the app uses). */
  email: string;
  phone: string;
  phone2: string;
  isPrimary: boolean;
}

export interface PropertyDTO {
  id: string;
  /** One line for buttons and titles, e.g. "Rental – 1 Example St". */
  name: string;
  label: string;
  street: string;
  unit: string;
  city: string;
  province: string;
  postalCode: string;
  propertyType: string;
  strataPlan: string;
  accessNotes: string;
  builtBefore1990: boolean;
}

const PROVINCES: [string, string][] = [
  ["BC", "British Columbia"], ["AB", "Alberta"], ["SK", "Saskatchewan"], ["MB", "Manitoba"], ["ON", "Ontario"], ["QC", "Quebec"], ["NB", "New Brunswick"],
  ["NS", "Nova Scotia"], ["PE", "Prince Edward Island"], ["NL", "Newfoundland and Labrador"], ["YT", "Yukon"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
];
const PROPERTY_TYPES: [string, string][] = [
  ["detached", "Detached house"], ["townhouse", "Townhouse"], ["condo", "Condo / apartment"], ["strata_complex", "Strata complex"], ["commercial", "Commercial"], ["other", "Other"],
];

/**
 * A dialog's form. Rendered only while its dialog is open, so every opening starts from
 * the saved values; a failed save keeps what was typed (submitWith) and says why.
 */
function DialogForm({
  action,
  onClose,
  submitLabel,
  danger,
  focus,
  children,
}: {
  action: Action;
  onClose: () => void;
  submitLabel: string;
  danger?: boolean;
  /** For confirmations without fields; forms focus the field marked data-autofocus. */
  focus?: "submit" | "cancel";
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(async (prev: FormState, f: FormData) => {
    const r = await action(prev, f);
    if (r?.ok) onClose();
    return r;
  }, null);
  return (
    <form onSubmit={submitWith(formAction)} className="space-y-3">
      {children}
      <FormError message={state?.error} />
      <div className="sticky bottom-0 -mx-5 -mb-4 mt-4 flex flex-wrap justify-end gap-2 border-t border-border bg-surface px-5 py-3">
        <Button variant="ghost" onClick={onClose} disabled={pending} data-autofocus={focus === "cancel" || undefined}>
          Cancel
        </Button>
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending} data-autofocus={focus === "submit" || undefined}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Check({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 text-sm">
      <input id={id} type="checkbox" name={name} defaultChecked={defaultChecked} aria-describedby={`${id}-hint`} className="mt-0.5 size-4 shrink-0" />
      <div>
        <label htmlFor={id} className="font-medium">{label}</label>
        <p id={`${id}-hint`} className="text-xs text-subtle">{hint}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export function EditCustomer({
  customer,
  primaryName,
}: {
  customer: { id: string; type: string; displayName: string; email: string; phone: string; source: string; tags: string; notes: string };
  primaryName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Edit customer</Button>
      <Dialog open={open} onClose={close} title="Edit customer">
        <DialogForm action={updateCustomerAction.bind(null, customer.id)} onClose={close} submitLabel="Save">
          <Field label="Name"><Input name="displayName" defaultValue={customer.displayName} required maxLength={200} data-autofocus /></Field>
          <Field label="Type">
            <Select name="type" defaultValue={customer.type}><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="strata">Strata</option></Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email"><Input name="email" type="email" defaultValue={customer.email} maxLength={200} /></Field>
            <Field label="Phone"><Input name="phone" type="tel" defaultValue={customer.phone} /></Field>
          </div>
          <p className="text-xs text-subtle">{primaryName ? `Saved on the primary contact, ${primaryName}. ` : ""}Emails from the app go to this address.</p>
          <Field label="Source"><Input name="source" defaultValue={customer.source} /></Field>
          <Field label="Tags" hint="Comma separated, e.g. VIP, repeat"><Input name="tags" defaultValue={customer.tags} /></Field>
          <Field label="Notes"><Textarea name="notes" defaultValue={customer.notes} maxLength={5000} /></Field>
        </DialogForm>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

function ContactFields({ c }: { c?: Partial<ContactDTO> }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name"><Input name="firstName" defaultValue={c?.firstName ?? ""} maxLength={100} data-autofocus /></Field>
        <Field label="Last name"><Input name="lastName" defaultValue={c?.lastName ?? ""} maxLength={100} /></Field>
      </div>
      <Field label="Title / role" hint="e.g. Property manager, Strata council president"><Input name="title" defaultValue={c?.title ?? ""} maxLength={500} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email"><Input name="email" type="email" defaultValue={c?.email ?? ""} maxLength={200} /></Field>
        <Field label="Phone"><Input name="phone" type="tel" defaultValue={c?.phone ?? ""} /></Field>
      </div>
      <Field label="Other phone (optional)"><Input name="phone2" type="tel" defaultValue={c?.phone2 ?? ""} /></Field>
    </>
  );
}

/** `prefill`: the customer's own email and phone, offered to its first contact. */
export function AddContact({ customerId, hasPrimary, prefill }: { customerId: string; hasPrimary: boolean; prefill?: { email: string; phone: string } }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>+ Add contact</Button>
      <Dialog open={open} onClose={close} title="Add contact" description={hasPrimary ? undefined : "This will be the primary contact: emails from the app go to them."}>
        <DialogForm action={addContactAction.bind(null, customerId)} onClose={close} submitLabel="Add contact">
          <ContactFields c={prefill} />
          {hasPrimary && <Check name="isPrimary" label="Primary contact" hint="Emails from the app go to the primary contact." />}
        </DialogForm>
      </Dialog>
    </>
  );
}

/** Edit, make primary and remove, for one contact. `others`: the customer's other contacts, oldest first. */
export function ContactActions({ contact, others, primaryName }: { contact: ContactDTO; others: { id: string; name: string }[]; primaryName: string | null }) {
  const [mode, setMode] = useState<"edit" | "primary" | "remove" | null>(null);
  const close = () => setMode(null);
  const title = mode === "edit" ? "Edit contact" : mode === "primary" ? `Make ${contact.name} the primary contact?` : `Remove ${contact.name}?`;
  return (
    <div className="-ml-2 flex flex-wrap gap-1 pt-1">
      <Button size="sm" variant="ghost" onClick={() => setMode("edit")} aria-label={`Edit ${contact.name}`}>Edit</Button>
      {!contact.isPrimary && <Button size="sm" variant="ghost" onClick={() => setMode("primary")} aria-label={`Make ${contact.name} primary`}>Make primary</Button>}
      <Button size="sm" variant="ghost" onClick={() => setMode("remove")} aria-label={`Remove ${contact.name}`}>Remove</Button>
      <Dialog open={mode !== null} onClose={close} title={title} description={mode === "edit" && contact.isPrimary ? "Primary contact: emails from the app go to this email." : undefined}>
        {mode === "edit" && (
          <DialogForm action={updateContactAction.bind(null, contact.id)} onClose={close} submitLabel="Save">
            <ContactFields c={contact} />
          </DialogForm>
        )}
        {mode === "primary" && (
          <DialogForm action={() => setPrimaryContactAction(contact.id)} onClose={close} submitLabel="Make primary" focus="submit">
            <p className="text-sm">
              {contact.email ? (
                <>Emails from the app will go to <strong className="break-all">{contact.email}</strong>.</>
              ) : (
                `${contact.name} has no email address, so the app can't email this customer until you add one.`
              )}
            </p>
            {primaryName && <p className="text-sm text-muted">{primaryName} stays on as a contact.</p>}
          </DialogForm>
        )}
        {mode === "remove" && (
          <DialogForm action={removeContactAction.bind(null, contact.id)} onClose={close} submitLabel="Remove contact" danger focus="cancel">
            {contact.isPrimary && others.length > 0 ? (
              <Field label="New primary contact" hint="Emails from the app will go to them.">
                <Select name="newPrimaryId" defaultValue={others[0].id}>
                  {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </Field>
            ) : contact.isPrimary ? (
              <p className="text-sm">{contact.name} is the only contact. The customer keeps this email and phone; you can change them with Edit customer.</p>
            ) : (
              <p className="text-sm">{contact.name} is taken off this customer. This can&apos;t be undone.</p>
            )}
          </DialogForm>
        )}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

function PropertyFields({ p }: { p?: PropertyDTO }) {
  const province = p?.province || "BC";
  return (
    <>
      <Field label="Street address"><Input name="street" defaultValue={p?.street ?? ""} required maxLength={300} data-autofocus /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Unit"><Input name="unit" defaultValue={p?.unit ?? ""} maxLength={500} /></Field>
        <Field label="City"><Input name="city" defaultValue={p?.city ?? ""} maxLength={500} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Province">
          <Select name="province" defaultValue={province}>
            {!PROVINCES.some(([code]) => code === province) && <option value={province}>{province}</option>}
            {PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </Select>
        </Field>
        <Field label="Postal code"><Input name="postalCode" defaultValue={p?.postalCode ?? ""} maxLength={20} autoCapitalize="characters" /></Field>
      </div>
      <Field label="Label (optional)" hint="e.g. Rental, Building A"><Input name="label" defaultValue={p?.label ?? ""} maxLength={500} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Property type">
          <Select name="propertyType" defaultValue={p?.propertyType ?? ""}>
            <option value="">Not set</option>
            {PROPERTY_TYPES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </Select>
        </Field>
        <Field label="Strata plan (optional)"><Input name="strataPlan" defaultValue={p?.strataPlan ?? ""} maxLength={500} /></Field>
      </div>
      <Field label="Access notes" hint="Gate or lockbox codes, parking, pets. New work orders start with these.">
        <Textarea name="accessNotes" rows={3} defaultValue={p?.accessNotes ?? ""} maxLength={1000} />
      </Field>
      <Check name="builtBefore1990" label="Built before 1990" hint="Crews are told to assume lead paint and asbestos may be present." defaultChecked={p?.builtBefore1990} />
    </>
  );
}

export function AddProperty({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>+ Add property</Button>
      <Dialog open={open} onClose={close} title="Add property">
        <DialogForm action={addPropertyAction.bind(null, customerId)} onClose={close} submitLabel="Add property">
          <PropertyFields />
        </DialogForm>
      </Dialog>
    </>
  );
}

export function PropertyActions({ property }: { property: PropertyDTO }) {
  const [mode, setMode] = useState<"edit" | "remove" | null>(null);
  const close = () => setMode(null);
  return (
    <div className="-ml-2 flex flex-wrap gap-1 pt-1">
      <Button size="sm" variant="ghost" onClick={() => setMode("edit")} aria-label={`Edit ${property.name}`}>Edit</Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("remove")} aria-label={`Remove ${property.name}`}>Remove</Button>
      <Dialog open={mode !== null} onClose={close} title={mode === "edit" ? "Edit property" : "Remove this property?"} description={mode === "remove" ? property.name : undefined}>
        {mode === "edit" && (
          <DialogForm action={updatePropertyAction.bind(null, property.id)} onClose={close} submitLabel="Save">
            <PropertyFields p={property} />
          </DialogForm>
        )}
        {mode === "remove" && (
          <DialogForm action={() => removePropertyAction(property.id)} onClose={close} submitLabel="Remove property" danger focus="cancel">
            <p className="text-sm">It&apos;s taken off this customer. This can&apos;t be undone.</p>
          </DialogForm>
        )}
      </Dialog>
    </div>
  );
}

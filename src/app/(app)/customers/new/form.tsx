"use client";
import { submitWith } from "@/components/submit";
import { useActionState } from "react";
import { Button, Card, CardHeader, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { createCustomerAction } from "../actions";

export function NewCustomerForm({ sources }: { sources: string[] }) {
  const [state, action, pending] = useActionState(createCustomerAction, null);
  return (
    <form onSubmit={submitWith(action)} className="max-w-3xl space-y-4">
      <Card>
        <CardHeader title="Customer" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Customer name" hint="Person, business or strata corporation" className="sm:col-span-2"><Input name="displayName" required autoFocus /></Field>
          <Field label="Type">
            <Select name="type" defaultValue="residential"><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="strata">Strata</option></Select>
          </Field>
          <Field label="Source"><Select name="source" defaultValue=""><option value="">—</option>{sources.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Tags" hint="Comma separated, e.g. VIP, repeat" className="sm:col-span-2"><Input name="tags" /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Primary contact" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="First name"><Input name="firstName" /></Field>
          <Field label="Last name"><Input name="lastName" /></Field>
          <Field label="Email"><Input name="email" type="email" /></Field>
          <Field label="Phone"><Input name="phone" type="tel" /></Field>
          <Field label="Title / role" hint="e.g. Property manager, Strata council president" className="sm:col-span-2"><Input name="title" /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Property" description="Optional. You can add more properties later." />
        <div className="grid gap-4 p-4 sm:grid-cols-6">
          <Field label="Street address" className="sm:col-span-4"><Input name="street" /></Field>
          <Field label="Unit" className="sm:col-span-2"><Input name="unit" /></Field>
          <Field label="City" className="sm:col-span-3"><Input name="city" /></Field>
          <Field label="Postal code" className="sm:col-span-3"><Input name="postalCode" /></Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-6">
            <input type="checkbox" name="builtBefore1990" className="mt-0.5 size-4 shrink-0" />
            <span>Built before 1990 <span className="text-subtle">(crews are told to assume lead paint and asbestos)</span></span>
          </label>
        </div>
      </Card>
      <Field label="Notes"><Textarea name="notes" /></Field>
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create customer"}</Button>
    </form>
  );
}

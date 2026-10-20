"use client";
import { useActionState, useState } from "react";
import { Button, Card, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { createLeadAction } from "../actions";

export function NewLeadForm({ sources, projectTypes }: { sources: string[]; projectTypes: string[] }) {
  const [state, action, pending] = useActionState(createLeadAction, null);
  const [more, setMore] = useState(false);
  const [stage, setStage] = useState("new_lead");

  return (
    <form action={action} className="max-w-3xl space-y-4">
      <Card className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name"><Input name="firstName" autoFocus /></Field>
          <Field label="Last name"><Input name="lastName" /></Field>
          <Field label="Email"><Input name="email" type="email" /></Field>
          <Field label="Phone"><Input name="phone" type="tel" /></Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Project type</legend>
          <div className="flex flex-wrap gap-2">
            {projectTypes.map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-2 rounded-full border border-border-strong px-3 py-1.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand">
                <input type="checkbox" name="projectTypes" value={t} className="sr-only" />{t}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status">
            <Select name="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="new_lead">New – needs contacting</option>
              <option value="contacted">Contacted</option>
              <option value="estimate_booked">Estimate booked</option>
            </Select>
          </Field>
          <Field label="How they reached us">
            <Select name="channel" defaultValue="phone">
              <option value="phone">Phone / text</option>
              <option value="email">Email</option>
              <option value="website_form">Website form</option>
              <option value="facebook">Facebook / Messenger</option>
              <option value="instagram">Instagram</option>
              <option value="referral">Referral</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="How they heard about us">
            <Select name="leadSource" defaultValue="">
              <option value="">—</option>
              {sources.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
        </div>
        {stage === "estimate_booked" && (
          <Field label="Estimate visit"><Input name="visitAt" type="datetime-local" required /></Field>
        )}
      </Card>

      {!more ? (
        <Button variant="ghost" onClick={() => setMore(true)}>+ Add address and project details</Button>
      ) : (
        <Card className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label="Street address" className="sm:col-span-4"><Input name="street" autoComplete="street-address" /></Field>
            <Field label="Unit" className="sm:col-span-2"><Input name="unit" /></Field>
            <Field label="City" className="sm:col-span-3"><Input name="city" /></Field>
            <Field label="Postal code" className="sm:col-span-3"><Input name="postalCode" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Property type">
              <Select name="propertyType" defaultValue="">
                <option value="">—</option>
                <option>Detached House</option><option>Townhouse</option><option>Condo / Apartment</option>
                <option>Strata Complex</option><option>Commercial</option>
              </Select>
            </Field>
            <Field label="Timeline">
              <Select name="timeline" defaultValue="">
                <option value="">—</option>
                <option>ASAP</option><option>Within 1 month</option><option>1–3 months</option>
                <option>3–6 months</option><option>Next season</option><option>Just getting pricing</option>
              </Select>
            </Field>
            <Field label="Company / strata (if applicable)" className="sm:col-span-2"><Input name="company" /></Field>
          </div>
          <Field label="Project description"><Textarea name="description" rows={3} /></Field>
          <Field label="Internal note"><Textarea name="notes" rows={2} /></Field>
        </Card>
      )}

      {state && !state.ok && <FormError message={state.error} />}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create lead"}</Button>
      </div>
    </form>
  );
}

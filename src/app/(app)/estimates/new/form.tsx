"use client";
import { submitWith } from "@/components/submit";
import { useActionState } from "react";
import { Button, Card, Field, FormError, Input, Select } from "@/components/ui";
import { createEstimateAction } from "../actions";

export function NewEstimateForm({ customers, defaultCustomer, opportunityId, defaultTitle }: { customers: { id: string; name: string }[]; defaultCustomer: string; opportunityId: string; defaultTitle: string }) {
  const [state, action, pending] = useActionState(createEstimateAction, null);
  return (
    <form onSubmit={submitWith(action)} className="max-w-xl">
      <Card className="space-y-4 p-4">
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <Field label="Customer">
          <Select name="customerId" defaultValue={defaultCustomer} required disabled={!!opportunityId}>
            <option value="">Choose a customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {opportunityId && <input type="hidden" name="customerId" value={defaultCustomer} />}
        </Field>
        <Field label="Job title" hint="e.g. Interior repaint – main floor"><Input name="title" defaultValue={defaultTitle} required autoFocus /></Field>
        <Field label="Job type">
          <Select name="jobType" defaultValue="interior">
            <option value="interior">Interior</option><option value="exterior">Exterior</option><option value="interior_exterior">Interior & exterior</option>
            <option value="cabinets">Cabinets</option><option value="staining">Deck / fence staining</option><option value="commercial">Commercial</option>
            <option value="strata">Strata</option><option value="repairs">Repairs</option>
          </Select>
        </Field>
        <FormError message={state && !state.ok ? state.error : null} />
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create and start estimating"}</Button>
      </Card>
    </form>
  );
}

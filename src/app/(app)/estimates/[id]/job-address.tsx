"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Select } from "@/components/ui";
import { setPropertyAction } from "../actions";
import type { WithSaved } from "./autosave";

export interface AddressOption {
  id: string;
  label: string;
}

/**
 * The job address in the estimate's header: one of the customer's addresses, picked here. It's on
 * the proposal, the contract and the crew's work order, so nothing is sent without one.
 */
export function JobAddress({
  estimateId,
  customerId,
  propertyId,
  addresses,
  canEdit,
  withSaved,
}: {
  estimateId: string;
  customerId: string;
  propertyId: string | null;
  addresses: AddressOption[];
  canEdit: boolean;
  withSaved: WithSaved;
}) {
  const router = useRouter();
  const current = addresses.find((a) => a.id === propertyId) ?? null;
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const picked = addresses.some((a) => a.id === choice) ? choice : (addresses.find((a) => a.id !== propertyId) ?? addresses[0])?.id ?? "";

  const save = () =>
    start(async () => {
      const r = await withSaved((version) => setPropertyAction(estimateId, picked, version));
      if (!r.ok) return setError(r.error);
      setError(null);
      setEditing(false);
      router.refresh();
    });

  if (!current && !addresses.length) {
    return (
      <span className="text-warning">
        No job address.{" "}
        {canEdit && (
          <Link href={`/customers/${customerId}`} className="underline">
            Add one on the customer&apos;s page
          </Link>
        )}
      </span>
    );
  }
  if (canEdit && (editing || !current)) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {!current && <span className="text-warning">No job address:</span>}
        <Select aria-label="Job address" value={picked} onChange={(e) => setChoice(e.target.value)} className="h-8 w-auto max-w-full text-sm">
          {addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
        <Button size="sm" variant="secondary" disabled={pending || !picked} onClick={save}>{current ? "Save" : "Use this address"}</Button>
        {current && <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>Cancel</Button>}
        {error && <span role="alert" className="text-danger">{error}</span>}
      </span>
    );
  }
  return (
    <span>
      {current ? current.label : <span className="text-warning">No job address</span>}
      {canEdit && current && addresses.length > 1 && (
        <button type="button" className="ml-1.5 text-brand hover:underline" onClick={() => setEditing(true)}>
          Change
        </button>
      )}
    </span>
  );
}

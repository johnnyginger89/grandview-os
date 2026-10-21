"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { acceptForCustomerAction } from "../actions";
import type { ProposalOption, ProposalRow } from "./proposal-types";

const METHODS = [
  { value: "phone", label: "By phone" },
  { value: "email", label: "By email" },
  { value: "in_person", label: "In person" },
  { value: "paper", label: "Signed a paper copy" },
] as const;
export const METHOD_PHRASE: Record<string, string> = { phone: "by phone", email: "by email", in_person: "in person", paper: "on paper" };

export function acceptedText(p: ProposalRow) {
  if (!p.acceptedAt) return null;
  return p.acceptedMethod && p.acceptedMethod !== "online"
    ? `Accepted ${METHOD_PHRASE[p.acceptedMethod] ?? ""} by ${p.acceptedName} on ${formatDateTime(p.acceptedAt)}`
    : `Signed by ${p.acceptedName} on ${formatDateTime(p.acceptedAt)}`;
}

export function AcceptDialog({ estimateId, defaultName, options, onClose }: { estimateId: string; defaultName: string; options: ProposalOption[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"] | "">("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      if (!method) return setError("Choose how they accepted.");
      const r = await acceptForCustomerAction(estimateId, { name, method, selectedOptionIds: chosen, note: note || undefined });
      if (!r.ok) return setError(r.error);
      router.push(r.projectId ? `/projects/${r.projectId}` : `/estimates/${estimateId}`);
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Mark as accepted"
      description="For when the customer said yes by phone, email, in person or on paper. The job is created right away and this estimate is locked, just like an online signature."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            <CircleCheck className="size-4" aria-hidden /> {pending ? "Saving…" : "Mark as accepted"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Who accepted it?">
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">How did they accept?</legend>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <label key={m.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border-strong px-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" name="accept-method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} className="size-4" />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>
        {options.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Optional upgrades they chose</legend>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {options.map((o) => (
                <li key={o.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={chosen.includes(o.id)}
                      onChange={(e) => setChosen((c) => (e.target.checked ? [...c, o.id] : c.filter((x) => x !== o.id)))}
                    />
                    <span className="flex-1">{o.title}</span>
                    <span className="tabular-nums text-muted">+{o.price}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <Field label="Note (optional)" hint="e.g. Accepted on the phone with Malcolm; wants to start after the 15th.">
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">The estimate is accepted exactly as it is now. If you changed it after sending, the customer is held to this version.</p>
        <FormError message={error} />
      </div>
    </Dialog>
  );
}


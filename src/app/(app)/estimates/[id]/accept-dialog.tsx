"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";
import { formatCAD } from "@/lib/money";
import { cn, formatDateTime } from "@/lib/utils";
import type { AcceptancePreview, ProposalTotals } from "@/server/proposals";
import { acceptForCustomerAction, acceptPreviewAction, acceptTotalsAction } from "../actions";
import type { WithSaved } from "./autosave";
import { BeforeSend, readyToSend } from "./before-send";
import type { ProposalProps, ProposalRow } from "./proposal-types";

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

/**
 * The office accepts for the customer. The editor's latest changes are saved first; the upgrades
 * start ticked the way the customer's proposal would have them, and the total is worked out the
 * same way as on their page.
 */
export function AcceptDialog({
  estimateId,
  defaultName,
  unlinkedLead = false,
  checks = { addressMissing: false, unpriced: [] },
  withSaved,
  onClose,
}: {
  estimateId: string;
  defaultName: string;
  unlinkedLead?: boolean;
  checks?: Pick<ProposalProps, "addressMissing" | "unpriced">;
  withSaved: WithSaved;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"] | "">("");
  const [preview, setPreview] = useState<AcceptancePreview | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [totals, setTotals] = useState<ProposalTotals | null>(null);
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const request = useRef(0);

  useEffect(() => {
    let live = true;
    void withSaved((version) => acceptPreviewAction(estimateId, version)).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      setPreview(r);
      setChosen(r.initialSelection);
      setTotals(r.totals);
    });
    return () => {
      live = false;
    };
  }, [estimateId, withSaved]);

  function toggle(id: string, on: boolean) {
    const next = on ? [...chosen, id] : chosen.filter((x) => x !== id);
    setChosen(next);
    // Only the answer to the latest tick counts.
    const n = ++request.current;
    setUpdating(true);
    acceptTotalsAction(estimateId, next)
      .then((r) => {
        if (n !== request.current) return;
        if (r.ok) setTotals(r.totals);
        else setError(r.error);
        setUpdating(false);
      })
      .catch(() => {
        if (n !== request.current) return;
        setError("Couldn't work out the new total. Check your connection and try again.");
        setUpdating(false);
      });
  }

  const submit = () =>
    start(async () => {
      setError(null);
      if (!method) return setError("Choose how they accepted.");
      const r = await withSaved((version) => acceptForCustomerAction(estimateId, { name, method, selectedOptionIds: chosen, note: note || undefined, expectedUpdatedAt: version, allowUnpriced: confirmed }));
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
          <Button onClick={submit} disabled={pending || !preview || updating || !readyToSend(checks, confirmed)}>
            <CircleCheck className="size-4" aria-hidden /> {pending ? "Saving…" : "Mark as accepted"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <BeforeSend proposals={checks} confirmed={confirmed} onConfirm={setConfirmed} verb="accept" />
        {unlinkedLead && (
          <p role="note" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
            This estimate isn&apos;t linked to a lead, so no lead will be marked won. Cancel and use <strong>Link to lead</strong> at the top of the estimate first.
          </p>
        )}
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
        {!preview && !error && (
          <p role="status" className="text-sm text-muted">
            Saving your latest changes…
          </p>
        )}
        {preview && preview.options.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Optional upgrades they chose</legend>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {preview.options.map((o) => (
                <li key={o.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" className="size-4" checked={chosen.includes(o.id)} disabled={pending} onChange={(e) => toggle(o.id, e.target.checked)} />
                    <span className="flex-1">
                      {o.title}
                      {o.area && <span className="block text-xs text-muted">{o.area}</span>}
                    </span>
                    <span className="tabular-nums text-muted">+{formatCAD(o.price)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        {totals && <AcceptTotals totals={totals} updating={updating} />}
        <Field label="Note (optional)" hint="e.g. Accepted on the phone with Malcolm; wants to start after the 15th.">
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">The estimate is accepted exactly as it is now. If you changed it after sending, the customer is held to this version.</p>
        <FormError message={error} />
      </div>
    </Dialog>
  );
}

function AcceptTotals({ totals, updating }: { totals: ProposalTotals; updating: boolean }) {
  return (
    <div>
      <dl aria-label="Total" aria-busy={updating} className="divide-y divide-border overflow-hidden rounded-lg border border-border text-sm">
        <div className="flex justify-between px-3 py-2">
          <dt className="text-muted">Before GST</dt>
          <dd className="tabular-nums">{formatCAD(totals.price)}</dd>
        </div>
        <div className="flex justify-between px-3 py-2">
          <dt className="text-muted">GST</dt>
          <dd className="tabular-nums">{formatCAD(totals.gst)}</dd>
        </div>
        <div className="flex justify-between bg-surface-2 px-3 py-2 font-semibold">
          <dt>Total incl. GST</dt>
          <dd className="tabular-nums" data-testid="accept-total">{formatCAD(totals.total)}</dd>
        </div>
        <div className="flex justify-between px-3 py-2">
          <dt className="text-muted">Deposit</dt>
          <dd className="tabular-nums" data-testid="accept-deposit">{formatCAD(totals.deposit)}</dd>
        </div>
      </dl>
      <p className={cn("mt-1 h-4 text-right text-xs text-subtle", !updating && "invisible")} aria-live="polite">
        {updating ? "Updating…" : ""}
      </p>
    </div>
  );
}

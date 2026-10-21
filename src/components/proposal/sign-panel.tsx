"use client";
import { useState, useTransition } from "react";
import { formatCAD } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { SignaturePad } from "./signature-pad";
import { OptionChecklist, useProposal } from "./state";

interface Accepted {
  name: string;
  at: string;
  signature: string;
  hash: string;
  message: string | null;
}

const field = "h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-base focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20";

export function SignPanel({
  labels,
  options,
  gstNote,
  depositNote,
  accepted,
}: {
  labels: { totalLabel: string; acceptLabel: string; declineLabel: string; agreeLabel: string };
  options: { id: string; title: string; price: string }[];
  gstNote: string | null;
  depositNote: string;
  accepted: Accepted | null;
}) {
  const { status, open, canSign, totals, mode, accept, decline } = useProposal();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (status === "accepted") {
    return (
      <div className="mx-auto max-w-xl space-y-3 rounded-2xl border border-border bg-surface p-6 text-sm shadow-sm">
        <p className="text-base font-semibold text-success">Accepted – thank you!</p>
        {accepted?.signature && (
          // eslint-disable-next-line @next/next/no-img-element -- signed data URL, not an optimisable asset
          <img src={accepted.signature} alt={`Signature of ${accepted.name}`} className="h-24 rounded border border-border bg-white" />
        )}
        <p>
          Accepted by <strong>{accepted?.name || name}</strong>
          {accepted?.at ? ` on ${formatDateTime(accepted.at)}` : ""} for <strong className="tabular-nums">{formatCAD(totals.total)}</strong>.
        </p>
        {accepted?.message && <p className="whitespace-pre-wrap text-muted">“{accepted.message}”</p>}
        {accepted?.hash && <p className="break-all text-xs text-subtle">Document fingerprint: {accepted.hash}</p>}
      </div>
    );
  }
  if (status === "declined") return <p className="mx-auto max-w-xl rounded-2xl bg-surface-2 p-6 text-center text-sm text-muted">This proposal was declined.</p>;
  if (!open) return null;

  function submit() {
    setError(null);
    start(async () => {
      const r = await accept({ name, email, signature, agree, message });
      if (r.ok) document.getElementById("cover")?.scrollIntoView({ behavior: "smooth" });
      else setError(r.error);
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-muted">{labels.totalLabel}</p>
        <p className="font-[family-name:var(--font-display)] text-4xl font-bold text-brand tabular-nums lg:text-[40px]">{formatCAD(totals.total)}</p>
        <p className="mt-1 text-sm text-muted">
          {depositNote}: <span className="tabular-nums">{formatCAD(totals.deposit)}</span>
          {gstNote ? ` · ${gstNote}` : ""}
        </p>
      </div>

      <OptionChecklist options={options} />

      <div className="print:hidden">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} disabled={!canSign} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Email (for your copy)</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={field} disabled={!canSign} />
          </label>
        </div>
        <div className="mt-4">
          <span className="mb-1 block text-sm font-medium">Signature</span>
          <SignaturePad onChange={setSignature} />
        </div>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium">Message (optional)</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={2} className={`${field} h-auto py-2`} disabled={!canSign} />
        </label>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={!canSign} />
          <span>
            {labels.agreeLabel} and that my electronic signature is legally binding. <a href="#terms" className="text-brand underline">Read the terms</a>
          </span>
        </label>
        {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
        <button
          type="button"
          disabled={pending || !canSign}
          onClick={submit}
          className="mt-5 flex h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-medium text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {pending ? "Submitting…" : `${labels.acceptLabel} – ${formatCAD(totals.total)}`}
        </button>
        <div className="mt-4 text-center">
          {!declining ? (
            <button type="button" onClick={() => setDeclining(true)} disabled={!canSign} className="min-h-11 text-sm text-muted underline-offset-2 hover:text-text hover:underline disabled:opacity-50">
              {labels.declineLabel}
            </button>
          ) : (
            <div className="space-y-2 text-left">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Reason (optional)</span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2} className={`${field} h-auto py-2`} />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await decline(reason);
                      if (!r.ok) setError(r.error);
                    })
                  }
                  className="h-11 rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
                >
                  Confirm decline
                </button>
                <button type="button" onClick={() => setDeclining(false)} className="h-11 px-3 text-sm text-muted hover:text-text">Cancel</button>
              </div>
            </div>
          )}
        </div>
        {!canSign && <p className="mt-3 text-center text-xs text-subtle">{mode === "staff" ? "Signing is disabled while you're signed in as staff." : "Signing is disabled in this preview."}</p>}
      </div>
      <p className="hidden text-sm print:block">Signature ______________________________ Date ______________</p>
    </div>
  );
}

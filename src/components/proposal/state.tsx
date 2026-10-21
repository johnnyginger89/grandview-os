"use client";
import { CheckCircle2, Printer } from "lucide-react";
import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { formatCAD } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ProposalTotals } from "@/server/proposals";

export type ProposalMode = "customer" | "staff" | "draft" | "sample";
type Result = { ok: true } | { ok: false; error: string };
export interface AcceptInput {
  name: string;
  email: string;
  signature: string;
  agree: boolean;
  message: string;
  selectedOptionIds: string[];
}

interface ProposalState {
  mode: ProposalMode;
  status: string;
  /** Options can still be changed and the proposal signed. */
  open: boolean;
  /** Signing and declining are real only on the customer link. */
  canSign: boolean;
  selected: Set<string>;
  toggle: (id: string) => void;
  totals: ProposalTotals;
  pending: boolean;
  accept: (input: Omit<AcceptInput, "selectedOptionIds">) => Promise<Result>;
  decline: (reason: string) => Promise<Result>;
}

const Ctx = createContext<ProposalState | null>(null);

export function useProposal() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useProposal must be used inside ProposalStateProvider");
  return s;
}

const DISABLED: Result = { ok: false, error: "Signing is disabled in this preview." };

export function ProposalStateProvider({
  mode,
  initialStatus,
  initialSelection,
  initialTotals,
  preview,
  acceptAction,
  declineAction,
  children,
}: {
  mode: ProposalMode;
  initialStatus: string;
  initialSelection: string[];
  initialTotals: ProposalTotals;
  /** Server actions, already bound to the proposal (customer) or estimate (draft). */
  preview: (selectedIds: string[]) => Promise<ProposalTotals | null>;
  acceptAction?: (input: AcceptInput) => Promise<Result>;
  declineAction?: (reason: string) => Promise<Result>;
  children: ReactNode;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [selected, setSelected] = useState(() => new Set(initialSelection));
  const [totals, setTotals] = useState(initialTotals);
  const [pending, start] = useTransition();
  const open = status === "sent" || status === "viewed";
  const canSign = mode === "customer" && open && !!acceptAction;

  function toggle(id: string) {
    if (!open) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    start(async () => {
      const t = await preview([...next]);
      if (t) setTotals(t);
    });
  }

  async function accept(input: Omit<AcceptInput, "selectedOptionIds">): Promise<Result> {
    if (!canSign || !acceptAction) return DISABLED;
    const r = await acceptAction({ ...input, selectedOptionIds: [...selected] });
    if (r.ok) setStatus("accepted");
    return r;
  }

  async function decline(reason: string): Promise<Result> {
    if (!canSign || !declineAction) return DISABLED;
    const r = await declineAction(reason);
    if (r.ok) setStatus("declined");
    return r;
  }

  return <Ctx.Provider value={{ mode, status, open, canSign, selected, toggle, totals, pending, accept, decline }}>{children}</Ctx.Provider>;
}

/** The dashed upgrade card on the estimate, with its "Add to my project" checkbox. */
export function OptionCard({ id, title, price, children }: { id: string; title: string; price: string; children: ReactNode }) {
  const { selected, toggle, open } = useProposal();
  const on = selected.has(id);
  return (
    <div className={cn("rounded-lg border-2 border-dashed p-4 transition-colors", on ? "border-brand bg-brand-soft" : "border-border-strong")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">{children}</div>
        <span className="shrink-0 text-base font-medium tabular-nums">+{formatCAD(price)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className={cn("flex min-h-11 items-center gap-2 text-sm font-medium", open ? "cursor-pointer" : "cursor-default")}>
          <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={on} disabled={!open} onChange={() => toggle(id)} />
          Add to my project<span className="sr-only">: {title}</span>
        </label>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", on ? "bg-brand text-white" : "bg-surface-2 text-muted")}>{on ? "Added" : "Not yet included"}</span>
      </div>
    </div>
  );
}

/** Compact checkbox list of upgrades, kept in sync with the estimate cards. */
export function OptionChecklist({ options }: { options: { id: string; title: string; price: string }[] }) {
  const { selected, toggle, open } = useProposal();
  if (!options.length) return null;
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-medium">Your selections</legend>
      {options.map((o) => (
        <label key={o.id} className={cn("flex min-h-11 items-center gap-3 rounded-md px-2 text-sm hover:bg-surface-2", !open && "cursor-default hover:bg-transparent")}>
          <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={selected.has(o.id)} disabled={!open} onChange={() => toggle(o.id)} />
          <span className="flex-1">{o.title}</span>
          <span className="tabular-nums text-muted">+{formatCAD(o.price)}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function TotalsBlock({ labels }: { labels: { subtotal: string; taxes: string | null; grandTotal: string; deposit: string } }) {
  const { totals, pending, open } = useProposal();
  return (
    <div className="break-inside-avoid md:ml-auto md:max-w-sm">
      <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border text-[15px]">
        <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">{labels.subtotal}</dt><dd className="tabular-nums">{formatCAD(totals.price)}</dd></div>
        {labels.taxes && <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">{labels.taxes}</dt><dd className="tabular-nums">{formatCAD(totals.gst)}</dd></div>}
        <div className="flex items-baseline justify-between bg-surface-2 px-4 py-3">
          <dt className="font-medium">{labels.grandTotal}</dt>
          <dd className="font-[family-name:var(--font-display)] text-2xl font-bold text-brand tabular-nums lg:text-[28px]" data-testid="grand-total">{formatCAD(totals.total)}</dd>
        </div>
        <div className="flex justify-between px-4 py-2.5 text-muted"><dt>{labels.deposit}</dt><dd className="tabular-nums">{formatCAD(totals.deposit)}</dd></div>
      </dl>
      <p className={cn("mt-1 h-4 text-right text-xs text-subtle print:hidden", !(pending && open) && "invisible")} aria-live="polite">{pending && open ? "Updating…" : ""}</p>
    </div>
  );
}

/** Phone-only bar with the total and a jump to the signing panel. Hidden while that panel is on screen. */
export function MobileStickyCta({ label }: { label: string }) {
  const { totals, open } = useProposal();
  const [nearSign, setNearSign] = useState(false);
  useEffect(() => {
    const target = document.getElementById("next-step");
    if (!target) return;
    const io = new IntersectionObserver(([e]) => setNearSign(e.isIntersecting), { rootMargin: "0px 0px -20% 0px" });
    io.observe(target);
    return () => io.disconnect();
  }, []);
  if (!open || nearSign) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(16,51,98,0.08)] lg:hidden print:hidden">
      <span className="text-sm">
        <span className="block text-xs text-muted">Total</span>
        <span className="font-semibold tabular-nums">{formatCAD(totals.total)}</span>
      </span>
      <a href="#next-step" className="flex h-11 items-center rounded-full bg-brand px-6 text-sm font-medium text-white hover:bg-brand-hover">{label}</a>
    </div>
  );
}

export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={cn("inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2 print:hidden", className)}>
      <Printer className="size-4" /> Print / save as PDF
    </button>
  );
}

export function StatusBanner({ contact }: { contact: string }) {
  const { status } = useProposal();
  if (status === "accepted")
    return (
      <div className="flex items-start gap-3 rounded-xl bg-success-soft p-4 text-success" role="status">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">Accepted – thank you!</p>
          <p className="text-sm">We&apos;ll be in touch shortly to confirm your deposit and schedule your start date.</p>
        </div>
      </div>
    );
  if (status === "declined")
    return <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted" role="status">This proposal was declined. Contact us any time if you&apos;d like an updated quote.</p>;
  if (status === "expired" || status === "superseded" || status === "withdrawn")
    return (
      <p className="rounded-xl bg-warning-soft p-4 text-sm text-warning" role="status">
        {status === "expired" ? "This proposal has expired." : "This proposal has been replaced by a newer version."} Please contact us at {contact} for an up-to-date proposal.
      </p>
    );
  return null;
}

/** "Review & sign · $X" pill for the sticky top bar. */
export function SignPill({ label }: { label: string }) {
  const { totals, open } = useProposal();
  if (!open) return null;
  return (
    <a href="#next-step" className="hidden h-10 shrink-0 items-center rounded-full bg-brand px-5 text-sm font-medium text-white hover:bg-brand-hover sm:flex">
      {label} · <span className="ml-1 tabular-nums">{formatCAD(totals.total)}</span>
    </a>
  );
}

"use client";
import Image from "next/image";
import { useState, useTransition } from "react";
import { CheckCircle2, Printer } from "lucide-react";
import { formatCAD, formatPct } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import type { ProposalTotals, ProposalView } from "@/server/proposals";
import { acceptAction, declineAction, previewTotalsAction } from "./actions";
import { SignaturePad } from "./signature-pad";

interface Data {
  status: string;
  view: ProposalView;
  initialSelection: string[];
  totals: ProposalTotals;
  accepted: { name: string; at: string; signature: string; hash: string } | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-border pt-6">
      <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg font-bold uppercase tracking-wide text-brand">{title}</h2>
      {children}
    </section>
  );
}

export function ProposalDocument({ token, data, staffPreview }: { token: string; data: Data; staffPreview: boolean }) {
  const { view } = data;
  const [selected, setSelected] = useState<Set<string>>(new Set(data.initialSelection));
  const [totals, setTotals] = useState(data.totals);
  const [status, setStatus] = useState(data.status);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [signature, setSignature] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const open = status === "sent" || status === "viewed";

  function toggle(id: string) {
    if (!open) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    start(async () => {
      const t = await previewTotalsAction(token, [...next]);
      if (t) setTotals(t);
    });
  }

  function accept() {
    setError(null);
    start(async () => {
      const r = await acceptAction(token, { name, email, signature, agree, selectedOptionIds: [...selected] });
      if (r.ok) {
        setStatus("accepted");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else setError(r.error);
    });
  }

  return (
    <div className="min-h-screen bg-bg py-6 print:bg-white print:py-0">
      {staffPreview && (
        <p className="mx-auto mb-3 max-w-3xl rounded-md bg-info-soft px-4 py-2 text-sm text-info print:hidden">
          Staff preview: you&apos;re signed in, so this visit isn&apos;t counted as a customer view.
        </p>
      )}
      <article className="mx-auto max-w-3xl space-y-6 bg-surface px-5 py-8 shadow-sm sm:rounded-lg sm:px-10 print:max-w-none print:shadow-none">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <Image src="/brand/logo-blue-tagline.png" alt={view.company.name} width={220} height={110} priority />
          <div className="text-sm text-muted sm:text-right">
            <p className="font-medium text-text">{view.company.name}</p>
            {view.company.address && <p>{view.company.address}</p>}
            {view.company.phone && <p>{view.company.phone}</p>}
            {view.company.email && <p>{view.company.email}</p>}
            {view.company.gstNumber && <p>GST {view.company.gstNumber}</p>}
          </div>
        </header>

        <div className="rounded-lg bg-sidebar px-6 py-5 text-white print:bg-white print:px-0 print:text-text">
          <p className="text-xs uppercase tracking-[0.2em] text-sidebar-text print:text-muted">Proposal #{view.number}{view.revision > 1 ? ` · revision ${view.revision}` : ""}</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{view.title}</h1>
          <p className="mt-2 text-sm">Prepared for <strong>{view.customerName}</strong>{view.address ? ` · ${view.address}` : ""}</p>
          <p className="mt-1 text-xs text-sidebar-text print:text-muted">Issued {view.issuedOn}{view.validUntil ? ` · valid until ${view.validUntil}` : ""}</p>
        </div>

        {status === "accepted" && (
          <div className="flex items-start gap-3 rounded-lg bg-success-soft p-4 text-success" role="status">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">Accepted – thank you!</p>
              <p className="text-sm">We&apos;ll be in touch shortly to confirm your deposit and schedule your start date.</p>
            </div>
          </div>
        )}
        {status === "declined" && <p className="rounded-lg bg-surface-2 p-4 text-sm text-muted">This proposal was declined. Contact us any time if you&apos;d like an updated quote.</p>}
        {(status === "expired" || status === "superseded" || status === "withdrawn") && (
          <p className="rounded-lg bg-warning-soft p-4 text-sm text-warning">
            {status === "expired" ? "This proposal has expired." : "This proposal has been replaced by a newer version."} Please contact us at {view.company.phone || view.company.email} for an up-to-date proposal.
          </p>
        )}

        <div className="space-y-3 text-[15px] leading-relaxed text-text">
          {view.contactName && <p>Hi {view.contactName.split(" ")[0]},</p>}
          {view.message && <p className="whitespace-pre-wrap">{view.message}</p>}
          <p>{view.intro}</p>
        </div>

        <Section title="Scope of work">
          <div className="space-y-4">
            {view.areas.map((a) => (
              <div key={a.id} className="break-inside-avoid rounded-md border border-border">
                <div className="flex items-center justify-between bg-surface-2 px-4 py-2">
                  <h3 className="font-semibold">{a.name}</h3>
                  {a.price && <span className="tabular text-sm">{formatCAD(a.price)}</span>}
                </div>
                <ul className="divide-y divide-border">
                  {a.items.map((i) => (
                    <li key={i.id} className="flex flex-col px-4 py-2 sm:flex-row sm:justify-between sm:gap-4">
                      <span>{i.title}</span>
                      {i.detail && <span className="text-sm text-muted">{i.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {view.customerNotes && <p className="mt-4 whitespace-pre-wrap rounded-md bg-surface-2 p-4 text-sm">{view.customerNotes}</p>}
        </Section>

        {view.products.length > 0 && (
          <Section title="Products & colours">
            <ul className="space-y-1 text-sm">
              {view.products.map((p) => (
                <li key={p.name}><span className="font-medium">{p.name}</span>{p.colours.length > 0 && <span className="text-muted"> – {p.colours.join("; ")}</span>}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Colours not listed will be confirmed with you before work begins.</p>
          </Section>
        )}

        {view.options.length > 0 && (
          <Section title="Optional upgrades">
            <p className="mb-3 text-sm text-muted">{open ? "Tick any upgrades you'd like. Your total updates instantly." : "Upgrades included in this agreement are ticked."}</p>
            <ul className="space-y-2">
              {view.options.map((o) => (
                <li key={o.id}>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${selected.has(o.id) ? "border-brand bg-brand-soft" : "border-border"} ${!open ? "cursor-default" : ""}`}>
                    <input type="checkbox" className="mt-1 size-4 accent-[var(--brand)]" checked={selected.has(o.id)} disabled={!open} onChange={() => toggle(o.id)} />
                    <span className="flex-1">
                      <span className="font-medium">{o.title}</span>
                      {o.area && <span className="block text-xs text-muted">{o.area}</span>}
                      {o.recommended && <span className="mt-1 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-info">Recommended</span>}
                    </span>
                    <span className="tabular font-medium">+{formatCAD(o.price)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Investment">
          <dl className="ml-auto max-w-sm space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Price</dt><dd className="tabular">{formatCAD(totals.price)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">GST ({formatPct(view.gstRate, 0)})</dt><dd className="tabular">{formatCAD(totals.gst)}</dd></div>
            <div className="flex justify-between border-t border-border pt-2 text-lg font-semibold"><dt>Total</dt><dd className="tabular">{formatCAD(totals.total)}</dd></div>
            <div className="flex justify-between text-muted"><dt>Deposit to book ({formatPct(view.depositPct, 0)})</dt><dd className="tabular">{formatCAD(totals.deposit)}</dd></div>
          </dl>
          {pending && open && <p className="mt-2 text-right text-xs text-subtle print:hidden">Updating…</p>}
        </Section>

        <Section title="Preparation"><p className="text-sm leading-relaxed">{view.sections.preparation}</p></Section>
        <div className="grid gap-6 sm:grid-cols-2">
          <Section title="Included"><ul className="list-disc space-y-1 pl-5 text-sm">{view.sections.inclusions.map((x) => <li key={x}>{x}</li>)}</ul></Section>
          <Section title="Not included"><ul className="list-disc space-y-1 pl-5 text-sm">{view.sections.exclusions.map((x) => <li key={x}>{x}</li>)}</ul></Section>
        </div>
        <Section title="Warranty"><p className="text-sm leading-relaxed">{view.sections.warranty}</p></Section>
        <Section title="Payment"><p className="text-sm leading-relaxed">{view.sections.paymentTerms}</p></Section>
        <Section title="Terms"><p className="text-sm leading-relaxed">{view.sections.terms}</p></Section>

        <Section title="Acceptance">
          {status === "accepted" || data.accepted ? (
            <div className="space-y-2 text-sm">
              {data.accepted?.signature && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.accepted.signature} alt={`Signature of ${data.accepted.name}`} className="h-24 rounded border border-border bg-white" />
              )}
              <p>Accepted by <strong>{data.accepted?.name || name}</strong>{data.accepted?.at ? ` on ${formatDateTime(data.accepted.at)}` : ""}</p>
              {data.accepted?.hash && <p className="break-all text-xs text-subtle">Document fingerprint: {data.accepted.hash}</p>}
            </div>
          ) : open ? (
            <div className="space-y-4 print:hidden">
              <p className="text-sm text-muted">By signing, you accept this proposal, including the upgrades ticked above, for a total of <strong className="text-text">{formatCAD(totals.total)}</strong> including GST.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm"><span className="mb-1 block font-medium">Full name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-10 w-full rounded-md border border-border-strong px-3" /></label>
                <label className="text-sm"><span className="mb-1 block font-medium">Email (for your copy)</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="h-10 w-full rounded-md border border-border-strong px-3" /></label>
              </div>
              <div><span className="mb-1 block text-sm font-medium">Signature</span><SignaturePad onChange={setSignature} /></div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                I have read and accept this proposal and its terms, and I agree that my electronic signature is legally binding.</label>
              {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={pending || staffPreview} onClick={accept} className="h-11 rounded-md bg-brand px-6 font-medium text-white hover:bg-brand-hover disabled:opacity-50">
                  {pending ? "Submitting…" : `Accept & sign – ${formatCAD(totals.total)}`}
                </button>
                {!declining ? (
                  <button type="button" onClick={() => setDeclining(true)} className="text-sm text-muted hover:text-text">Decline</button>
                ) : (
                  <span className="flex flex-1 flex-wrap items-center gap-2">
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional: let us know why" className="h-9 min-w-48 flex-1 rounded-md border border-border-strong px-3 text-sm" />
                    <button type="button" disabled={pending || staffPreview} onClick={() => start(async () => { const r = await declineAction(token, reason); if (r.ok) setStatus("declined"); else setError(r.error); })} className="h-9 rounded-md border border-border-strong px-3 text-sm">Confirm decline</button>
                  </span>
                )}
              </div>
              {staffPreview && <p className="text-xs text-subtle">Signing is disabled in staff preview.</p>}
            </div>
          ) : null}
        </Section>

        <footer className="flex items-center justify-between border-t border-border pt-4 text-xs text-subtle">
          <span>{view.company.name} · Proposal #{view.number}</span>
          <button type="button" onClick={() => window.print()} className="flex items-center gap-1 text-brand hover:underline print:hidden"><Printer className="size-3.5" /> Print / save as PDF</button>
        </footer>
      </article>
    </div>
  );
}

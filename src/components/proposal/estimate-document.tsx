import Image from "next/image";
import { formatCAD, formatPct } from "@/lib/money";
import type { ProposalViewV2, ServiceLine } from "@/server/proposal-view";
import { Blocks } from "./parts";
import { OptionCard, PrintButton, TotalsBlock } from "./state";

function LineBody({ line }: { line: ServiceLine }) {
  return (
    <>
      <p className="text-base font-medium">
        {line.title}
        {line.kind === "option" && !/^optional\b/i.test(line.title) && <span className="ml-2 inline-block rounded-full border border-border-strong px-2 py-0.5 align-middle text-xs font-medium text-muted">Optional</span>}
      </p>
      {line.areaName && line.kind === "option" && <p className="text-sm text-subtle">{line.areaName}</p>}
      <Blocks blocks={line.blocks} className="mt-2 text-[15px] leading-relaxed text-muted" />
    </>
  );
}

function Line({ line }: { line: ServiceLine }) {
  return (
    <li className="flex gap-4 py-5 break-inside-avoid first:pt-0">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-medium text-white tabular-nums" aria-hidden="true">{line.no}</span>
      <div className="min-w-0 flex-1">
        <span className="sr-only">{line.no}. </span>
        {line.kind === "option" && line.optionId ? (
          <OptionCard id={line.optionId} title={line.title} price={line.price ?? "0"}>
            <LineBody line={line} />
          </OptionCard>
        ) : (
          <>
            <LineBody line={line} />
            {line.price && line.kind !== "option" && <p className="mt-1 text-sm text-muted tabular-nums">{formatCAD(line.price)}</p>}
          </>
        )}
      </div>
    </li>
  );
}

/** The estimate itself, laid out like a printed estimate: FROM / TO, numbered services, totals. */
export function EstimateDocument({ view }: { view: ProposalViewV2 }) {
  const { company: c, labels: L } = view;
  const gstPct = formatPct(view.gstRate, 0);
  const depositPct = formatPct(view.depositPct, 0);
  return (
    <>
      <article className="-mx-4 bg-surface p-5 text-[15px] shadow-sm sm:mx-auto sm:max-w-[840px] sm:rounded-xl sm:p-12 lg:text-base print:mx-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-6">
          <Image src="/brand/logo-blue.png" alt={c.displayName} width={200} height={100} className="h-auto w-40 sm:w-[200px]" />
          <div className="text-right">
            <h3 className="font-[family-name:var(--font-display)] text-2xl font-bold text-brand sm:text-[32px]">{L.documentTitle}</h3>
            <p className="mt-1 font-medium tabular-nums"># {view.displayNumber}{view.revision > 1 ? ` · rev ${view.revision}` : ""}</p>
            {view.validUntil && <p className="mt-2 inline-block rounded-full bg-surface-2 px-3 py-1 text-sm text-muted">Valid until {view.validUntil}</p>}
          </div>
        </header>

        <div className="grid gap-6 border-b border-border py-6 md:grid-cols-2">
          <div className="space-y-0.5 text-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-subtle">{L.from}</p>
            <p className="font-bold text-text">{c.displayName}</p>
            {c.licenceNumber && <p>{c.licenceLabel || L.licence}: {c.licenceNumber}</p>}
            {c.gstNumber && <p>{L.gst} {c.gstNumber}</p>}
            {c.addressLines.map((l) => <p key={l}>{l}</p>)}
            {c.email && <p><a href={`mailto:${c.email}`} className="text-brand hover:underline">{c.email}</a></p>}
            {c.phones.map((p) => (
              <p key={p.number}>
                {p.label ? `${p.label}: ` : ""}
                <a href={p.tel} className="text-brand hover:underline">{p.number}</a>
              </p>
            ))}
          </div>
          <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 text-sm md:justify-self-end">
            <dt className="text-muted">{L.estimateDate}</dt><dd className="font-medium">{view.issuedOn}</dd>
            {view.validUntil && <><dt className="text-muted">{L.expiryDate}</dt><dd className="font-medium">{view.validUntil}</dd></>}
            {view.poNumber && <><dt className="text-muted">{L.poNumber}</dt><dd className="font-medium">{view.poNumber}</dd></>}
          </dl>
          <div className="space-y-0.5 text-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-subtle">{L.to}</p>
            <p className="font-bold text-text">{view.customerName}</p>
            {view.contactName && view.contactName !== view.customerName && <p>{view.contactName}</p>}
            {view.jobAddress && <p>{view.jobAddress}</p>}
            {view.customerPhone && <p>{view.customerPhone}</p>}
          </div>
          {view.jobAddress && (
            <div className="space-y-0.5 text-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-subtle">{L.jobLocation}</p>
              <p>{view.jobAddress}</p>
            </div>
          )}
          <div className="text-sm md:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-subtle">{L.job}</p>
            <p className="font-medium text-text">{view.title}</p>
          </div>
        </div>

        <div className="py-6">
          <h4 className="mb-5 font-[family-name:var(--font-display)] text-xl font-bold text-brand">{L.services}</h4>
          <ol className="divide-y divide-border">
            {view.lines.map((l) => <Line key={`${l.kind}-${l.no}`} line={l} />)}
          </ol>
        </div>

        <TotalsBlock
          labels={{
            subtotal: L.subtotal,
            taxes: view.showTaxLine ? `${L.taxes} (GST ${gstPct})` : null,
            grandTotal: L.grandTotal,
            deposit: `${L.deposit} (${depositPct})`,
          }}
        />

        <div className="mt-8 space-y-4 border-t border-border pt-6 text-sm">
          {view.paymentMethods.length > 0 && (
            <p><span className="font-bold">{L.paymentMethods}:</span> {view.paymentMethods.join(", ")}</p>
          )}
          {view.message && (
            <div>
              <p className="font-bold">{L.message}</p>
              <p className="mt-1 whitespace-pre-wrap text-muted">{view.message}</p>
            </div>
          )}
          {view.footerNotes.length > 0 && (
            <div>
              <p className="font-bold">{L.terms}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted marker:text-accent">{view.footerNotes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
        </div>
      </article>
      <div className="mt-6 flex justify-center">
        <PrintButton />
      </div>
    </>
  );
}

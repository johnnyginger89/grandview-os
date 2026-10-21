import type { ReactNode } from "react";
import type { ProposalContract } from "@/server/proposal-view";
import { ContractExpander } from "./contract-expander";
import { Blocks } from "./parts";

/**
 * One titled part of the contract. On phones each part folds (<details>, first one open);
 * from md up, and when printing, ContractExpander opens them all.
 */
function Part({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <details open={first} className="group border-b border-border py-4 md:border-0 md:py-0 print:border-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 md:pointer-events-none md:min-h-0 [&::-webkit-details-marker]:hidden">
        <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-brand lg:text-[22px]">{title}</h3>
        <span className="text-xl text-muted transition-transform group-open:rotate-45 md:hidden" aria-hidden="true">+</span>
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

function List({ items, ordered }: { items: string[]; ordered?: boolean }) {
  const L = ordered ? "ol" : "ul";
  return (
    <L className={`${ordered ? "list-decimal" : "list-disc"} space-y-2 pl-6 marker:font-medium marker:text-accent`}>
      {items.map((x, i) => <li key={i} className="whitespace-pre-line pl-1">{x}</li>)}
    </L>
  );
}

export function Contract({ contract: c }: { contract: ProposalContract }) {
  const parts: { title: string; body: ReactNode }[] = [];
  if (c.scopeOfWork.title && c.scopeOfWork.blocks.length) parts.push({ title: c.scopeOfWork.title, body: <Blocks blocks={c.scopeOfWork.blocks} /> });
  if (c.terms.title && c.terms.items.length) parts.push({ title: c.terms.title, body: <List items={c.terms.items} ordered /> });
  const w = c.warranty;
  if (w.title && (w.intro.length || w.conditions.length || w.exclusions.length)) {
    parts.push({
      title: w.title,
      body: (
        <>
          <Blocks blocks={w.intro} />
          {w.conditions.length > 0 && <List items={w.conditions} />}
          {w.exclusions.length > 0 && (
            <>
              <p>{w.exclusionsLeadIn}</p>
              <ul className="list-disc space-y-2 pl-6 marker:text-accent">
                {w.exclusions.map((x, i) => (
                  <li key={i} className="pl-1">
                    {x.text}
                    {x.note && <em className="block text-muted">{x.note}</em>}
                    {x.children.length > 0 && <ul className="mt-1 list-[circle] space-y-1 pl-6">{x.children.map((y, j) => <li key={j}>{y}</li>)}</ul>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <Blocks blocks={w.closing} />
        </>
      ),
    });
  }
  if (c.quality.title && c.quality.items.length) parts.push({ title: c.quality.title, body: <List items={c.quality.items} ordered /> });
  if (c.paints.title && c.paints.items.length) {
    parts.push({
      title: c.paints.title,
      body: (
        <ul className="list-disc space-y-2 pl-6 marker:text-accent">
          {c.paints.items.map((x, i) =>
            x.emphasis ? (
              <li key={i} className="-ml-6 list-none rounded-lg bg-warning-soft p-4 font-medium">{x.text}</li>
            ) : (
              <li key={i} className="pl-1">{x.text}</li>
            ),
          )}
        </ul>
      ),
    });
  }
  if (c.unforeseen.title && c.unforeseen.blocks.length) parts.push({ title: c.unforeseen.title, body: <Blocks blocks={c.unforeseen.blocks} /> });
  if (c.customerResponsibility.title && c.customerResponsibility.items.length) parts.push({ title: c.customerResponsibility.title, body: <List items={c.customerResponsibility.items} /> });
  if (c.insurance.title && c.insurance.blocks.length)
    parts.push({
      title: c.insurance.title,
      body: (
        <>
          <Blocks blocks={c.insurance.blocks} />
          <p className="print:hidden"><a href="#insurance" className="text-brand underline">See our insurance documents</a></p>
        </>
      ),
    });
  if (c.acceptance.title && c.acceptance.items.length) parts.push({ title: c.acceptance.title, body: <List items={c.acceptance.items} /> });
  if (c.payment.title && c.payment.items.length) parts.push({ title: c.payment.title, body: <List items={c.payment.items} /> });

  return (
    <div className="mx-auto max-w-[72ch] text-base leading-[1.65]" data-contract>
      <Blocks blocks={c.intro} className="mb-6" />
      <ContractExpander />
      <div className="md:space-y-10">
        {parts.map((p, i) => (
          <Part key={p.title + i} title={p.title} first={i === 0}>
            {p.body}
          </Part>
        ))}
      </div>
    </div>
  );
}

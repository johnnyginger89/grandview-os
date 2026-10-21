import { MapPin, Phone } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Block, WorkOrderPaint, WorkOrderScopeItem, WorkOrderSection, WorkOrderView } from "@/server/work-order-view";
import { PrintButton } from "./print-button";

/*
 * The crew's work order: the same component for the share link, /my-jobs and the
 * staff preview. It only ever receives a WorkOrderView (crew-safe by construction)
 * and the office's name and phone. Mobile-first, printable with the browser.
 */

export interface WorkOrderNotice {
  tone: "info" | "warning";
  title: string;
  body?: string;
}

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function Prose({ blocks, className }: { blocks: Block[]; className?: string }) {
  if (!blocks.length) return null;
  return (
    <div className={cn("space-y-2 leading-relaxed", className)}>
      {blocks.map((b, i) =>
        b.type === "p" ? (
          <p key={i} className="whitespace-pre-line">{b.text}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-accent">
            {b.items.map((x, j) => <li key={j}>{x}</li>)}
          </ul>
        ),
      )}
    </div>
  );
}

function Section({ id, title, changed, children }: { id: WorkOrderSection; title: string; changed: boolean; children: ReactNode }) {
  return (
    <section
      aria-labelledby={`wo-${id}`}
      data-section={id}
      data-changed={changed ? "true" : undefined}
      className={cn("border-b border-border px-4 py-5 last:border-b-0 sm:px-8 print:break-inside-avoid print:px-0", changed && "border-l-4 border-l-accent bg-info-soft/40 pl-3 sm:pl-7 print:pl-3")}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id={`wo-${id}`} className="font-[family-name:var(--font-display)] text-lg font-bold uppercase tracking-wide text-brand">{title}</h2>
        {changed && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Changed</span>}
      </div>
      {children}
    </section>
  );
}

function Removed() {
  return <p className="text-muted">Removed in this version.</p>;
}

function ItemFacts({ item }: { item: WorkOrderScopeItem }) {
  const facts = [
    item.quantity && item.unit ? `${item.quantity} ${item.unit}` : null,
    item.coats ? plural(item.coats, "coat") : null,
    item.colour ? `Colour: ${item.colour}` : null,
    item.sheen ? `Sheen: ${item.sheen}` : null,
    item.product ? `Product: ${item.product}` : null,
    item.hours ? `${item.hours} h` : null,
  ].filter((f): f is string => !!f);
  if (!facts.length) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5 text-sm" aria-label="Details">
      {facts.map((f) => <li key={f} className="rounded-md bg-surface-2 px-2 py-0.5 print:bg-transparent print:px-0 print:pr-3">{f}</li>)}
    </ul>
  );
}

function PaintList({ rows }: { rows: WorkOrderPaint[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Paint to order">
      {rows.map((r, i) => (
        <li key={i} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2.5 print:break-inside-avoid">
          <div className="min-w-0">
            <p className="font-medium">{r.product}</p>
            <p className="text-sm text-muted">{[r.colour ? `Colour: ${r.colour}` : "Colour to be confirmed", r.sheen ? `Sheen: ${r.sheen}` : null].filter(Boolean).join(" · ")}</p>
            {r.note && <p className="mt-0.5 text-sm text-warning">{r.note}</p>}
          </div>
          <p className="shrink-0 text-right font-semibold tabular-nums">{r.amount ?? "Ask the office"}</p>
        </li>
      ))}
    </ul>
  );
}

export function WorkOrderDocument({
  view,
  office,
  changed = [],
  notice,
}: {
  view: WorkOrderView;
  office: { name: string; phone: string | null };
  /** Sections to highlight as changed since the version the viewer saw last. */
  changed?: readonly WorkOrderSection[];
  notice?: WorkOrderNotice | null;
}) {
  const is = (s: WorkOrderSection) => changed.includes(s);
  const show = (s: WorkOrderSection, hasContent: boolean) => hasContent || is(s);
  const allCrews = !view.crew;

  return (
    <article className="mx-auto w-full max-w-3xl bg-surface text-[15px] text-text sm:rounded-xl sm:border sm:border-border sm:shadow-sm lg:text-base print:max-w-none print:border-0 print:shadow-none">
      <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-5 sm:px-8 sm:py-6 print:px-0">
        <Image src="/brand/logo-blue.png" alt={office.name || "Grandview Painting"} width={160} height={80} className="h-auto w-28 sm:w-36" loading="eager" />
        <div className="text-right">
          <p className="font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-wide text-brand">Work order</p>
          <p className="font-medium tabular-nums">{view.number} · Version {view.version}</p>
          <p className="text-sm text-muted">Issued {view.issuedOn}</p>
        </div>
      </header>

      {notice && (
        <div role="status" className={cn("mx-4 mt-4 rounded-lg px-4 py-3 sm:mx-8 print:mx-0", notice.tone === "warning" ? "bg-warning-soft text-warning" : "bg-info-soft text-info")}>
          <p className="font-semibold">{notice.title}</p>
          {notice.body && <p className="mt-0.5 text-sm">{notice.body}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-4 pt-4 sm:px-8 print:hidden">
        <PrintButton />
      </div>

      <Section id="details" title="Job" changed={is("details")}>
        <p className="text-lg font-semibold leading-snug">{view.title}</p>
        <dl className="mt-3 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
          <dt className="text-muted">Job number</dt>
          <dd className="tabular-nums">#{view.projectNumber}{view.jobTypeLabel ? ` · ${capitalise(view.jobTypeLabel)}` : ""}</dd>
          <dt className="text-muted">Customer</dt>
          <dd>
            {view.customerName}
            {view.customerPhone && (
              <a href={tel(view.customerPhone)} className="mt-1 flex min-h-11 w-fit items-center gap-1.5 font-medium text-brand underline-offset-2 hover:underline sm:min-h-0">
                <Phone className="size-4" aria-hidden /> {view.customerPhone}
              </a>
            )}
          </dd>
          <dt className="text-muted">Crew</dt>
          <dd>{view.crew ? <>{view.crew.name}{view.crew.lead && <span className="text-muted"> · Lead: {view.crew.lead}</span>}</> : "All crews on this job"}</dd>
          {view.projectManager && (
            <>
              <dt className="text-muted">Office contact</dt>
              <dd>
                {view.projectManager.name}
                {view.projectManager.phone && (
                  <a href={tel(view.projectManager.phone)} className="mt-1 flex min-h-11 w-fit items-center gap-1.5 font-medium text-brand underline-offset-2 hover:underline sm:min-h-0">
                    <Phone className="size-4" aria-hidden /> {view.projectManager.phone}
                  </a>
                )}
              </dd>
            </>
          )}
        </dl>
      </Section>

      <Section id="bookings" title="Schedule" changed={is("bookings")}>
        {view.bookings.length ? (
          <ul className="space-y-3">
            {view.bookings.map((b, i) => (
              <li key={`${b.startDate}-${i}`} className="rounded-lg border border-border p-3">
                <p className="font-medium">{b.dates}</p>
                <p className="text-sm text-muted">
                  {b.label} · {plural(b.workDays, "work day")}
                  {allCrews && b.crewName ? ` · ${b.crewName}` : ""}
                </p>
                {b.crewNotes && <p className="mt-1.5 whitespace-pre-line text-sm">{b.crewNotes}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Dates to be confirmed. The office will let you know.</p>
        )}
      </Section>

      <Section id="access" title="Address and access" changed={is("access")}>
        {view.address ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium">{view.address}</p>
            {view.mapsUrl && (
              <a href={view.mapsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-contrast hover:bg-brand-hover print:hidden">
                <MapPin className="size-4" aria-hidden /> Open in Maps
              </a>
            )}
          </div>
        ) : (
          <p className="text-muted">No address on file. Call the office.</p>
        )}
        {view.accessNotes && (
          <div className="mt-3 rounded-lg bg-surface-2 p-3 print:bg-transparent print:p-0">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Getting in</p>
            <p className="mt-1 whitespace-pre-line">{view.accessNotes}</p>
          </div>
        )}
      </Section>

      <Section id="scope" title="Scope of work" changed={is("scope")}>
        {view.labourHours && (
          <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-sm print:bg-transparent print:px-0">
            <span className="font-semibold">Estimated labour: {view.labourHours} hours</span>
            <span className="text-muted">{view.prepHours ? ", prep included" : ""} (total for the whole crew)</span>
          </p>
        )}
        {view.scope.length ? (
          <div className="space-y-5">
            {view.scope.map((area, i) => (
              <div key={`${area.area}-${i}`} className="print:break-inside-avoid">
                <h3 className="flex items-baseline justify-between gap-3 font-semibold">
                  <span>{area.area}</span>
                  {area.hours && <span className="shrink-0 text-sm font-medium text-muted tabular-nums">{area.hours} h</span>}
                </h3>
                {area.description && <p className="text-sm text-muted">{area.description}</p>}
                <ul className="mt-2 space-y-3">
                  {area.items.map((item, j) => (
                    <li key={j} className="border-l-2 border-border pl-3">
                      <p className="font-medium">{item.title}</p>
                      <ItemFacts item={item} />
                      <Prose blocks={item.detail} className="mt-1.5 text-sm text-muted" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">No painting items on this job. Check the special instructions below.</p>
        )}
      </Section>

      {show("paint", !!view.paint?.length) && (
        <Section id="paint" title="Paint to order" changed={is("paint")}>
          {view.paint?.length ? (
            <>
              <PaintList rows={view.paint} />
              <p className="mt-2 text-xs text-muted">Worked out from the measurements, coats and each product&apos;s coverage, with a little extra for waste.</p>
            </>
          ) : (
            <Removed />
          )}
        </Section>
      )}

      {show("preparation", view.preparation.length > 0 || !!view.prepHours) && (
        <Section id="preparation" title="Preparation" changed={is("preparation")}>
          {view.prepHours && <p className="mb-2 text-sm font-medium">About {view.prepHours} hours of prep.</p>}
          {view.preparation.length ? <Prose blocks={view.preparation} /> : view.prepHours ? null : <Removed />}
        </Section>
      )}

      {show("excluded", view.excluded.length > 0) && (
        <Section id="excluded" title="Not included" changed={is("excluded")}>
          {view.excluded.length ? (
            <ul className="list-disc space-y-1 pl-5 marker:text-danger">
              {view.excluded.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          ) : (
            <Removed />
          )}
        </Section>
      )}

      {show("specialInstructions", view.specialInstructions.length > 0) && (
        <Section id="specialInstructions" title="Special instructions" changed={is("specialInstructions")}>
          {view.specialInstructions.length ? <Prose blocks={view.specialInstructions} /> : <Removed />}
        </Section>
      )}

      {show("equipment", view.equipment.length > 0) && (
        <Section id="equipment" title="Equipment" changed={is("equipment")}>
          {view.equipment.length ? <Prose blocks={view.equipment} /> : <Removed />}
        </Section>
      )}

      {show("safety", view.safety.length > 0) && (
        <Section id="safety" title="Safety" changed={is("safety")}>
          {view.safety.length ? <Prose blocks={view.safety} /> : <Removed />}
        </Section>
      )}

      {show("checklist", view.checklist.length > 0) && (
        <Section id="checklist" title="Checklist" changed={is("checklist")}>
          {view.checklist.length ? (
            <ul className="space-y-2" aria-label="Checklist">
              {view.checklist.map((c) => (
                <li key={c.id} className="flex items-start gap-3">
                  <span aria-hidden className="mt-0.5 size-5 shrink-0 rounded border-2 border-border-strong" />
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Removed />
          )}
        </Section>
      )}

      <footer className="border-t border-border bg-bg px-4 py-5 text-center sm:rounded-b-xl sm:px-8 print:bg-transparent print:px-0">
        <p className="font-semibold">Questions? Call the office.</p>
        {office.phone ? (
          <a href={tel(office.phone)} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 font-medium text-brand hover:bg-surface-2 print:min-h-0 print:border-0 print:p-0">
            <Phone className="size-4" aria-hidden /> {office.phone}
          </a>
        ) : null}
        {office.name && <p className="mt-2 text-sm text-muted">{office.name}</p>}
      </footer>
    </article>
  );
}

/** The banner for a viewer who last saw an older version. */
export function updateNotice(view: WorkOrderView, fromVersion: number, changedCount: number): WorkOrderNotice {
  return {
    tone: "warning",
    title: `Updated ${view.issuedOn}: version ${view.version} replaces version ${fromVersion}.`,
    body: changedCount ? "Check the highlighted sections." : "Nothing you'd notice changed, but this is now the version to follow.",
  };
}

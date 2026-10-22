"use client";
import { useActionState, useEffect, useState } from "react";
import { FileText, LayoutTemplate, Search } from "lucide-react";
import { submitWith } from "@/components/submit";
import { Card, Field, FormError, Input } from "@/components/ui";
import { jobTypeForProjectTypes } from "@/lib/pipeline/job-type-from-lead";
import { cn } from "@/lib/utils";
import type { LeadChoice } from "@/server/estimate-lead";
import { createEstimateAction, findCustomersAction, openLeadsAction } from "../actions";

const JOB_TYPES = [
  ["interior", "Interior"],
  ["exterior", "Exterior"],
  ["interior_exterior", "Interior & exterior"],
  ["cabinets", "Cabinets"],
  ["staining", "Deck / fence staining"],
  ["commercial", "Commercial"],
  ["strata", "Strata"],
  ["repairs", "Repairs"],
] as const;

type Customer = { id: string; name: string; detail: string };

/** "#1023 · Interior, Cabinets · Estimate booked" */
function leadLabel(l: LeadChoice): string {
  return [`#${l.number}`, l.projectTypes.length ? l.projectTypes.join(", ") : l.title, l.stage].filter(Boolean).join(" · ");
}

/** One open lead is picked for you; with several, you choose (undefined until then). No lead is null. */
function firstChoice(leads: LeadChoice[]): string | null | undefined {
  return leads.length === 1 ? leads[0].id : leads.length ? undefined : null;
}

/** Pick a customer (search, not a long list) and their lead, a job type, then tap how to start. */
export function NewEstimateForm({
  customer: fixed,
  lead,
  leads: initialLeads,
  defaultTitle,
  templates,
}: {
  customer: Customer | null;
  /** Started from a lead: the estimate is for it. */
  lead: LeadChoice | null;
  /** The fixed customer's open leads, when not started from a lead. */
  leads: LeadChoice[];
  defaultTitle: string;
  templates: { id: string; name: string; jobType: string }[];
}) {
  const [state, action, pending] = useActionState(createEstimateAction, null);
  const [customer, setCustomer] = useState<Customer | null>(fixed);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Customer[]>([]);
  const [leads, setLeads] = useState<LeadChoice[]>(initialLeads);
  const [leadId, setLeadId] = useState<string | null | undefined>(lead ? lead.id : firstChoice(initialLeads));
  const leadFor = (id: string | null | undefined) => (lead && id === lead.id ? lead : leads.find((l) => l.id === id));
  const [jobType, setJobType] = useState<string>(() => jobTypeForProjectTypes(leadFor(leadId)?.projectTypes ?? []) ?? "interior");
  // The lead suggests the job type until the estimator picks one.
  const [jobTypePicked, setJobTypePicked] = useState(false);

  const chooseLead = (id: string | null, choices = leads) => {
    setLeadId(id);
    const suggested = jobTypeForProjectTypes(choices.find((l) => l.id === id)?.projectTypes ?? []);
    if (!jobTypePicked && suggested) setJobType(suggested);
  };
  const pickCustomer = (c: Customer) => {
    setCustomer(c);
    setLeads([]);
    setLeadId(undefined);
    openLeadsAction(c.id).then(
      (found) => {
        setLeads(found);
        const first = firstChoice(found);
        if (first) chooseLead(first, found);
        else setLeadId(first);
      },
      () => setLeadId(null),
    );
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => findCustomersAction(q).then((r) => live && setHits(r)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const ready = !!customer && !pending && leadId !== undefined;
  const forType = templates.filter((t) => t.jobType === jobType);
  const others = templates.filter((t) => t.jobType !== jobType);
  const card = "flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm font-medium shadow-card hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <form onSubmit={submitWith(action)} className="max-w-xl">
      <Card className="space-y-5 p-4">
        <input type="hidden" name="opportunityId" value={leadId ?? ""} />
        <input type="hidden" name="customerId" value={customer?.id ?? ""} />
        <input type="hidden" name="jobType" value={jobType} />

        <div>
          <p className="mb-1.5 text-sm font-medium">Customer</p>
          {customer ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <span className="min-w-0">
                <span className="block font-medium">{customer.name}</span>
                {customer.detail && <span className="block truncate text-xs text-muted">{customer.detail}</span>}
              </span>
              {!lead && !fixed && (
                <button type="button" className="min-h-9 text-sm text-brand hover:underline" onClick={() => { setCustomer(null); setQuery(""); setHits([]); setLeads([]); setLeadId(null); }}>
                  Change
                </button>
              )}
            </div>
          ) : (
            <div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
                <Input aria-label="Find the customer" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, address, phone or email" className="pl-9" autoFocus />
              </div>
              {query.trim().length >= 2 && (
                <ul className="mt-1 divide-y divide-border rounded-lg border border-border" aria-label="Matching customers">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" onClick={() => pickCustomer(h)} className="block min-h-11 w-full px-3 py-2 text-left hover:bg-surface-2">
                        <span className="block text-sm font-medium">{h.name}</span>
                        {h.detail && <span className="block truncate text-xs text-muted">{h.detail}</span>}
                      </button>
                    </li>
                  ))}
                  {hits.length === 0 && <li className="px-3 py-2 text-sm text-muted">No customer matches. Add them first under Customers.</li>}
                </ul>
              )}
            </div>
          )}
        </div>

        {lead ? (
          <div>
            <p className="mb-1.5 text-sm font-medium">Lead</p>
            <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">{leadLabel(lead)}</p>
          </div>
        ) : (
          customer &&
          leads.length > 0 && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Lead</legend>
              {leadId === undefined && <p className="mb-1.5 text-xs text-muted">{customer.name} has {leads.length} open leads. Pick the one this estimate is for.</p>}
              <div className="space-y-1.5">
                {[...leads.map((l) => ({ id: l.id as string | null, label: leadLabel(l) })), { id: null, label: "No lead (not counted in the sales figures)" }].map((o) => (
                  <label key={o.id ?? "none"} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border-strong px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                    <input type="radio" name="leadChoice" checked={leadId === o.id} onChange={() => chooseLead(o.id)} className="size-4" />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )
        )}

        <div>
          <p className="mb-1.5 text-sm font-medium">Job type</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Job type">
            {JOB_TYPES.map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={jobType === v}
                onClick={() => {
                  setJobType(v);
                  setJobTypePicked(true);
                }}
                className={cn("min-h-9 rounded-full border px-3 text-sm", jobType === v ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:border-brand hover:text-brand")}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <Field label="Job title (optional)" hint={defaultTitle ? undefined : "Left empty, it's named from the job type and address, e.g. “Interior repaint – 1 Main St”."}>
          <Input name="title" defaultValue={defaultTitle} maxLength={200} />
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-medium">
            Start from {!customer ? <span className="font-normal text-muted">(choose the customer first)</span> : leadId === undefined ? <span className="font-normal text-muted">(pick the lead first)</span> : ""}
          </p>
          <div className="space-y-2">
            {forType.map((t) => (
              <button key={t.id} type="submit" name="templateId" value={t.id} disabled={!ready} className={card}>
                <LayoutTemplate className="size-5 shrink-0 text-brand" aria-hidden /> {t.name}
              </button>
            ))}
            <button type="submit" name="templateId" value="" disabled={!ready} className={card}>
              <FileText className="size-5 shrink-0 text-muted" aria-hidden /> {pending ? "Starting…" : "Start blank"}
            </button>
            {others.length > 0 && (
              <details className="text-sm">
                <summary className="min-h-9 cursor-pointer py-2 text-muted">Templates for other job types ({others.length})</summary>
                <div className="space-y-2">
                  {others.map((t) => (
                    <button key={t.id} type="submit" name="templateId" value={t.id} disabled={!ready} className={card}>
                      <LayoutTemplate className="size-5 shrink-0 text-muted" aria-hidden /> {t.name}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
        <FormError message={state && !state.ok ? state.error : null} />
      </Card>
    </form>
  );
}

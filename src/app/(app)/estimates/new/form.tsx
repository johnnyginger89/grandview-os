"use client";
import { useActionState, useEffect, useState } from "react";
import { FileText, LayoutTemplate, Search } from "lucide-react";
import { submitWith } from "@/components/submit";
import { Card, Field, FormError, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createEstimateAction, findCustomersAction } from "../actions";

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

/** Pick a customer (search, not a long list), a job type, then tap how to start. */
export function NewEstimateForm({
  customer: fixed,
  opportunityId,
  defaultTitle,
  templates,
}: {
  customer: Customer | null;
  opportunityId: string;
  defaultTitle: string;
  templates: { id: string; name: string; jobType: string }[];
}) {
  const [state, action, pending] = useActionState(createEstimateAction, null);
  const [customer, setCustomer] = useState<Customer | null>(fixed);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Customer[]>([]);
  const [jobType, setJobType] = useState("interior");

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

  const forType = templates.filter((t) => t.jobType === jobType);
  const others = templates.filter((t) => t.jobType !== jobType);
  const card = "flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm font-medium shadow-card hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <form onSubmit={submitWith(action)} className="max-w-xl">
      <Card className="space-y-5 p-4">
        <input type="hidden" name="opportunityId" value={opportunityId} />
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
              {!opportunityId && !fixed && (
                <button type="button" className="min-h-9 text-sm text-brand hover:underline" onClick={() => { setCustomer(null); setQuery(""); setHits([]); }}>
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
                      <button type="button" onClick={() => setCustomer(h)} className="block min-h-11 w-full px-3 py-2 text-left hover:bg-surface-2">
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

        <div>
          <p className="mb-1.5 text-sm font-medium">Job type</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Job type">
            {JOB_TYPES.map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={jobType === v}
                onClick={() => setJobType(v)}
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
          <p className="mb-1.5 text-sm font-medium">Start from {customer ? "" : <span className="font-normal text-muted">(choose the customer first)</span>}</p>
          <div className="space-y-2">
            {forType.map((t) => (
              <button key={t.id} type="submit" name="templateId" value={t.id} disabled={!customer || pending} className={card}>
                <LayoutTemplate className="size-5 shrink-0 text-brand" aria-hidden /> {t.name}
              </button>
            ))}
            <button type="submit" name="templateId" value="" disabled={!customer || pending} className={card}>
              <FileText className="size-5 shrink-0 text-muted" aria-hidden /> {pending ? "Starting…" : "Start blank"}
            </button>
            {others.length > 0 && (
              <details className="text-sm">
                <summary className="min-h-9 cursor-pointer py-2 text-muted">Templates for other job types ({others.length})</summary>
                <div className="space-y-2">
                  {others.map((t) => (
                    <button key={t.id} type="submit" name="templateId" value={t.id} disabled={!customer || pending} className={card}>
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

import { Eye, Plus, Search } from "lucide-react";
import Link from "next/link";
import { Pager } from "@/components/pager";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatCAD, formatPct } from "@/lib/money";
import { firstParam, pageHref, parsePage } from "@/lib/paging";
import { formatDate } from "@/lib/utils";
import { listEstimates, type EstimateListRow } from "@/server/estimate-list";
import { getProposalTemplate } from "@/server/settings";
import { STATUS_TONE } from "./status";

export const metadata = { title: "Estimates" };

const STATUSES = ["", "draft", "sent", "accepted", "declined"] as const;
const monthOf = { format: (at: Date) => formatDate(at, { month: "long", year: "numeric" }) };
const dayOf = { format: (at: Date) => formatDate(at, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) };

export default async function EstimatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("estimates.read");
  const sp = await searchParams;
  const raw = firstParam(sp.status);
  const status = (STATUSES as readonly string[]).includes(raw) ? (raw as (typeof STATUSES)[number]) : "";
  const q = firstParam(sp.q).trim().slice(0, 100);
  const costing = can(user.role, "estimates.costing");

  const [list, template] = await Promise.all([listEstimates({ status, q, page: parsePage(sp.page), costing }), getProposalTemplate()]);
  const prefix = template.estimateDocument.numberPrefix;

  const groups = new Map<string, EstimateListRow[]>();
  for (const r of list.rows) {
    const key = monthOf.format(r.listedAt);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const href = (s: string) => pageHref("/estimates", { status: s, q }, 1);

  return (
    <>
      <PageHeader title="Estimates" actions={can(user.role, "estimates.write") && <LinkButton href="/estimates/new"><Plus className="size-4" /> New estimate</LinkButton>} />
      <form action="/estimates" className="mb-3 flex gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <label className="relative flex-1">
          <span className="sr-only">Search estimates</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <input name="q" defaultValue={q} placeholder="Search by customer, job or number" className="h-10 w-full rounded-md border border-border-strong bg-surface pr-3 pl-9 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </label>
      </form>
      <div className="mb-4 flex flex-wrap gap-1">
        {STATUSES.map((s) => (
          <Link key={s} href={href(s)} className={`rounded-md px-3 py-1.5 text-sm ${status === s ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2"}`}>{s ? s[0].toUpperCase() + s.slice(1) : "All"}</Link>
        ))}
      </div>
      {list.rows.length === 0 ? (
        <EmptyState title={q || status ? "No estimates match" : "No estimates yet"} description={q || status ? "Try a different search or filter." : "Start one from a lead, a customer, or the New estimate button."} />
      ) : (
        <Card className="overflow-hidden">
          {[...groups.entries()].map(([month, rows]) => (
            <section key={month} aria-label={month}>
              <h2 className="border-b border-border bg-surface-2 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted">{month}</h2>
              <ul className="divide-y divide-border">
                {rows.map((e) => (
                  <li key={e.id}>
                    <Link href={`/estimates/${e.id}`} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2">
                      <span className="min-w-0 font-medium">
                        {e.customer} <span className="font-normal text-muted">({e.title})</span>
                      </span>
                      <span className="text-right font-semibold tabular-nums">{formatCAD(e.totalWithTax)}</span>
                      <span className="flex items-center gap-3 text-sm text-muted">
                        <span className="tabular-nums">{prefix}{e.number}</span>
                        {e.firstViewedAt && (
                          <span className="flex items-center gap-1 text-accent" title={`Customer opened it ${e.viewCount} time${e.viewCount === 1 ? "" : "s"}`}>
                            <Eye className="size-4" aria-hidden="true" />
                            <span className="sr-only">Viewed by the customer</span>
                            {e.viewCount > 1 && <span className="text-xs">{e.viewCount}</span>}
                          </span>
                        )}
                        {e.costing && <span className="hidden text-xs md:inline">margin {formatPct(e.costing.margin)} · {Number(e.costing.hours).toFixed(1)} h</span>}
                      </span>
                      <span className="flex items-center justify-end gap-2 text-sm text-muted">
                        <span className="hidden sm:inline">{dayOf.format(e.listedAt)}</span>
                        <Badge tone={STATUS_TONE[e.status]}>{e.status === "sent" && e.firstViewedAt ? "viewed" : e.status}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      )}
      <Pager info={list} path="/estimates" params={{ status, q }} />
    </>
  );
}

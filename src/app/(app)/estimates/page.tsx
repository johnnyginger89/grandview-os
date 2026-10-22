import { and, desc, eq, ilike, max, ne, or, sql, sum } from "drizzle-orm";
import { Eye, Plus, Search } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { customers, estimates, proposals } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatCAD, formatPct, margin } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { getProposalTemplate } from "@/server/settings";
import { STATUS_TONE } from "./status";

export const metadata = { title: "Estimates" };

const STATUSES = ["", "draft", "sent", "accepted", "declined"] as const;
const monthOf = { format: (at: Date) => formatDate(at, { month: "long", year: "numeric" }) };
const dayOf = { format: (at: Date) => formatDate(at, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) };

export default async function EstimatesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requirePermission("estimates.read");
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : "";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const costing = can(user.role, "estimates.costing");

  // How often the customer opened any live proposal for each estimate.
  const views = db
    .select({ estimateId: proposals.estimateId, firstViewedAt: max(proposals.firstViewedAt).as("first_viewed_at"), viewCount: sum(proposals.viewCount).as("view_count") })
    .from(proposals)
    .where(ne(proposals.status, "withdrawn"))
    .groupBy(proposals.estimateId)
    .as("views");

  const number = q.replace(/^est-?/i, "");
  const [rows, template] = await Promise.all([
    db
      .select({ e: estimates, customer: customers.displayName, firstViewedAt: views.firstViewedAt, viewCount: views.viewCount })
      .from(estimates)
      .innerJoin(customers, eq(customers.id, estimates.customerId))
      .leftJoin(views, eq(views.estimateId, estimates.id))
      .where(
        and(
          status ? eq(estimates.status, status as "draft") : undefined,
          q
            ? or(
                ilike(customers.displayName, `%${q}%`),
                ilike(estimates.title, `%${q}%`),
                /^\d+$/.test(number) ? sql`${estimates.number}::text like ${`%${number}%`}` : undefined,
              )
            : undefined,
        ),
      )
      .orderBy(desc(sql`coalesce(${estimates.sentAt}, ${estimates.createdAt})`))
      .limit(300),
    getProposalTemplate(),
  ]);
  const prefix = template.estimateDocument.numberPrefix;

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = monthOf.format(r.e.sentAt ?? r.e.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const href = (s: string) => `/estimates?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(q ? { q } : {}) })}`;

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
      {rows.length === 0 ? (
        <EmptyState title={q || status ? "No estimates match" : "No estimates yet"} description={q || status ? "Try a different search or filter." : "Start one from a lead, a customer, or the New estimate button."} />
      ) : (
        <Card className="overflow-hidden">
          {[...groups.entries()].map(([month, list]) => (
            <section key={month} aria-label={month}>
              <h2 className="border-b border-border bg-surface-2 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted">{month}</h2>
              <ul className="divide-y divide-border">
                {list.map(({ e, customer, firstViewedAt, viewCount }) => {
                  const opened = Number(viewCount ?? 0);
                  return (
                    <li key={e.id}>
                      <Link href={`/estimates/${e.id}`} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2">
                        <span className="min-w-0 font-medium">
                          {customer} <span className="font-normal text-muted">({e.title})</span>
                        </span>
                        <span className="text-right font-semibold tabular-nums">{formatCAD(e.totalWithTax)}</span>
                        <span className="flex items-center gap-3 text-sm text-muted">
                          <span className="tabular-nums">{prefix}{e.number}</span>
                          {firstViewedAt && (
                            <span className="flex items-center gap-1 text-accent" title={`Customer opened it ${opened} time${opened === 1 ? "" : "s"}`}>
                              <Eye className="size-4" aria-hidden="true" />
                              <span className="sr-only">Viewed by the customer</span>
                              {opened > 1 && <span className="text-xs">{opened}</span>}
                            </span>
                          )}
                          {costing && <span className="hidden text-xs md:inline">margin {formatPct(margin(e.totalPrice, e.totalCost))} · {Number(e.totalHours).toFixed(1)} h</span>}
                        </span>
                        <span className="flex items-center justify-end gap-2 text-sm text-muted">
                          <span className="hidden sm:inline">{dayOf.format(e.sentAt ?? e.createdAt)}</span>
                          <Badge tone={STATUS_TONE[e.status]}>{e.status === "sent" && firstViewedAt ? "viewed" : e.status}</Badge>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </Card>
      )}
    </>
  );
}

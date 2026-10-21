import { Calculator, ClipboardList, FileText, Search, Users, Workflow } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/authz/guard";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH } from "@/lib/search/query";
import type { SearchKind } from "@/lib/search/types";
import { canSearch, globalSearch } from "@/server/search";

export const metadata = { title: "Search" };

const KIND_ICON: Record<SearchKind, ComponentType<{ className?: string }>> = {
  customer: Users,
  job: ClipboardList,
  estimate: Calculator,
  lead: Workflow,
  work_order: FileText,
};

/** Every match for a search, grouped. The top-bar box shows the first few. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const user = await requireUser();
  if (!canSearch(user.role)) redirect("/no-access");
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : (raw ?? "")).slice(0, MAX_QUERY_LENGTH);
  const result = q.trim().length >= MIN_QUERY_LENGTH ? await globalSearch(user, q, { perGroup: 25 }) : null;
  const total = result?.groups.reduce((n, g) => n + g.hits.length, 0) ?? 0;

  return (
    <>
      <PageHeader title="Search" description={result ? `${total} match${total === 1 ? "" : "es"} for “${result.query}”` : "Find customers, addresses, sold jobs, estimates, leads and work orders."} />
      <form action="/search" className="mb-6" role="search">
        <label className="relative block max-w-2xl">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            name="q"
            type="search"
            defaultValue={q}
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Name, street, phone number, #3033, EST-5001…"
            className="h-11 w-full rounded-lg border border-border-strong bg-surface pr-3 pl-9 text-base focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none sm:text-sm"
          />
        </label>
      </form>

      {!result ? null : result.groups.length === 0 ? (
        <EmptyState title={`No matches for “${result.query}”`} description="Try part of a name or street, a phone number, or a job number like #3033." />
      ) : (
        <div className="space-y-6">
          {result.groups.map((g) => {
            const Icon = KIND_ICON[g.kind];
            return (
              <section key={g.kind} aria-labelledby={`results-${g.kind}`}>
                <h2 id={`results-${g.kind}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {g.label} <span className="font-normal">({g.hits.length}{g.more ? "+" : ""})</span>
                </h2>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-border">
                    {g.hits.map((h) => (
                      <li key={h.id}>
                        <Link href={h.href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted"><Icon className="size-4" aria-hidden /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-text">{h.title}</span>
                            {h.detail && <span className="block truncate text-sm text-muted">{h.detail}</span>}
                          </span>
                          {h.status && <Badge tone={h.status.tone} className="shrink-0">{h.status.label}</Badge>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
                {g.more && <p className="mt-2 text-sm text-muted">Showing the first {g.hits.length}. Add another word to narrow it down.</p>}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { Pager } from "@/components/pager";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Table, td, th } from "@/components/ui";
import { CUSTOMER_TYPES } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { firstParam, pageHref, parsePage } from "@/lib/paging";
import { MAX_QUERY_LENGTH } from "@/lib/search/query";
import { formatDate } from "@/lib/utils";
import { listCustomers, type CustomerType } from "@/server/customer-list";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("customers.read");
  const sp = await searchParams;
  const q = firstParam(sp.q).trim().slice(0, MAX_QUERY_LENGTH);
  const raw = firstParam(sp.type);
  const type = (CUSTOMER_TYPES as readonly string[]).includes(raw) ? (raw as CustomerType) : "";
  const list = await listCustomers({ q, type, page: parsePage(sp.page) });
  const rows = list.rows;

  return (
    <>
      <PageHeader title="Customers" actions={can(user.role, "customers.write") && <LinkButton href="/customers/new"><Plus className="size-4" /> New customer</LinkButton>} />
      <form className="mb-4 flex flex-wrap gap-2">
        {type && <input type="hidden" name="type" value={type} />}
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-subtle" />
          <Input name="q" defaultValue={q} placeholder="Search name, address, email or phone" aria-label="Search customers" className="pl-9" />
        </div>
        <div className="flex gap-1">
          {["", ...CUSTOMER_TYPES].map((t) => (
            <Link key={t} href={pageHref("/customers", { q, type: t }, 1)} className={`rounded-md px-3 py-2 text-sm ${type === t ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2"}`}>
              {t ? t[0].toUpperCase() + t.slice(1) : "All"}
            </Link>
          ))}
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={q ? "No customers match that search" : "No customers yet"} description="Customers are created automatically from leads, or you can add one directly." />
      ) : (
        <Card>
          <Table>
            <thead><tr><th className={th}>Name</th><th className={th}>Type</th><th className={`${th} hidden md:table-cell`}>Contact</th><th className={`${th} hidden sm:table-cell`}>City</th><th className={`${th} hidden lg:table-cell`}>Added</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <td className={td}>
                    <Link href={`/customers/${r.id}`} className="font-medium text-text hover:text-brand">{r.name}</Link>
                    {r.tags.length > 0 && <span className="ml-2 inline-flex gap-1">{r.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span>}
                  </td>
                  <td className={td}><Badge tone={r.type === "strata" ? "info" : r.type === "commercial" ? "brand" : "neutral"}>{r.type}</Badge></td>
                  <td className={`${td} hidden text-muted md:table-cell`}>{r.email ?? r.phone ?? "—"}</td>
                  <td className={`${td} hidden text-muted sm:table-cell`}>{r.city ?? "—"}</td>
                  <td className={`${td} hidden text-muted lg:table-cell`}>{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Pager info={list} path="/customers" params={{ q, type }} />
    </>
  );
}

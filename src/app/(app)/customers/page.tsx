import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Table, td, th } from "@/components/ui";
import { db } from "@/db";
import { customers, properties } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const user = await requirePermission("customers.read");
  const { q = "", type = "" } = await searchParams;
  const term = `%${q.trim()}%`;
  const rows = await db
    .select({
      id: customers.id,
      name: customers.displayName,
      type: customers.type,
      email: customers.email,
      phone: customers.phone,
      tags: customers.tags,
      createdAt: customers.createdAt,
      city: sql<string | null>`(select ${properties.city} from ${properties} where ${properties.customerId} = ${customers.id} limit 1)`,
    })
    .from(customers)
    .where(
      and(
        isNull(customers.archivedAt),
        type ? eq(customers.type, type as "residential") : undefined,
        q ? or(ilike(customers.displayName, term), ilike(customers.email, term), ilike(customers.phone, term)) : undefined,
      ),
    )
    .orderBy(desc(customers.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader title="Customers" actions={can(user.role, "customers.write") && <LinkButton href="/customers/new"><Plus className="size-4" /> New customer</LinkButton>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-subtle" />
          <Input name="q" defaultValue={q} placeholder="Search name, email or phone" className="pl-9" />
        </div>
        <div className="flex gap-1">
          {["", "residential", "commercial", "strata"].map((t) => (
            <Link key={t} href={`/customers?${new URLSearchParams({ q, type: t })}`} className={`rounded-md px-3 py-2 text-sm ${type === t ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2"}`}>
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
    </>
  );
}

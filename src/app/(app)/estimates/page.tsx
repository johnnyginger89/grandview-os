import { desc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, td, th } from "@/components/ui";
import { db } from "@/db";
import { customers, estimates } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatCAD, formatPct, margin } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { STATUS_TONE } from "./status";

export const metadata = { title: "Estimates" };


export default async function EstimatesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePermission("estimates.read");
  const { status } = await searchParams;
  const costing = can(user.role, "estimates.costing");
  const rows = await db
    .select({ e: estimates, customer: customers.displayName })
    .from(estimates)
    .innerJoin(customers, eq(customers.id, estimates.customerId))
    .where(status ? eq(estimates.status, status as "draft") : undefined)
    .orderBy(desc(estimates.updatedAt))
    .limit(300);

  return (
    <>
      <PageHeader title="Estimates" actions={can(user.role, "estimates.write") && <LinkButton href="/estimates/new"><Plus className="size-4" /> New estimate</LinkButton>} />
      <div className="mb-4 flex flex-wrap gap-1">
        {["", "draft", "sent", "accepted", "declined"].map((s) => (
          <Link key={s} href={s ? `/estimates?status=${s}` : "/estimates"} className={`rounded-md px-3 py-1.5 text-sm ${(status ?? "") === s ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2"}`}>{s ? s[0].toUpperCase() + s.slice(1) : "All"}</Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No estimates yet" description="Start one from a lead, a customer, or the New estimate button." />
      ) : (
        <Card>
          <Table>
            <thead><tr>
              <th className={th}>#</th><th className={th}>Customer / job</th><th className={th}>Status</th>
              <th className={`${th} text-right`}>Price</th>
              {costing && <th className={`${th} hidden text-right md:table-cell`}>Margin</th>}
              <th className={`${th} hidden text-right sm:table-cell`}>Hours</th><th className={`${th} hidden lg:table-cell`}>Updated</th>
            </tr></thead>
            <tbody>
              {rows.map(({ e, customer }) => (
                <tr key={e.id} className="hover:bg-surface-2">
                  <td className={`${td} text-muted tabular`}>{e.number}</td>
                  <td className={td}><Link href={`/estimates/${e.id}`} className="font-medium hover:text-brand">{customer}</Link><span className="text-muted"> · {e.title}</span></td>
                  <td className={td}><Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>{e.revision > 0 && <span className="ml-1 text-xs text-subtle">rev {e.revision}</span>}</td>
                  <td className={`${td} text-right tabular`}>{formatCAD(e.totalPrice)}</td>
                  {costing && <td className={`${td} hidden text-right tabular md:table-cell`}>{formatPct(margin(e.totalPrice, e.totalCost))}</td>}
                  <td className={`${td} hidden text-right tabular sm:table-cell`}>{Number(e.totalHours).toFixed(1)}</td>
                  <td className={`${td} hidden text-muted lg:table-cell`}>{formatDate(e.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

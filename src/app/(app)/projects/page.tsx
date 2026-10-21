import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { db } from "@/db";
import { customers, projects, properties } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatCAD } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "./status";

export const metadata = { title: "Sold jobs" };

export default async function ProjectsPage() {
  const user = await requirePermission("projects.read_all");
  const showMoney = can(user.role, "financials.read") || can(user.role, "estimates.costing");
  const rows = await db
    .select({ p: projects, customer: customers.displayName, city: properties.city })
    .from(projects)
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(properties, eq(properties.id, projects.propertyId))
    .orderBy(desc(projects.createdAt))
    .limit(300);
  return (
    <>
      <PageHeader title="Sold jobs" description="Every signed job, from scheduling to finished. Added automatically when a customer signs." />
      {rows.length === 0 ? (
        <EmptyState title="No sold jobs yet" description="Send a proposal from an estimate. When the customer signs it, the job appears here." />
      ) : (
        <Card>
          <Table>
            <thead><tr><th className={th}>#</th><th className={th}>Project</th><th className={th}>Status</th>{showMoney && <th className={`${th} text-right`}>Contract</th>}<th className={`${th} hidden md:table-cell`}>Start</th></tr></thead>
            <tbody>
              {rows.map(({ p, customer, city }) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <td className={`${td} tabular text-muted`}>{p.number}</td>
                  <td className={td}><Link href={`/projects/${p.id}`} className="font-medium hover:text-brand">{customer}</Link><span className="text-muted"> · {p.name.split(" – ").slice(1).join(" – ")}{city ? ` · ${city}` : ""}</span></td>
                  <td className={td}><Badge tone={PROJECT_STATUS_TONE[p.status]}>{PROJECT_STATUS_LABEL[p.status]}</Badge></td>
                  {showMoney && <td className={`${td} text-right tabular`}>{formatCAD(p.contractTotal)}</td>}
                  <td className={`${td} hidden text-muted md:table-cell`}>{p.startDate ? formatDate(p.startDate) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

import Link from "next/link";
import { Pager } from "@/components/pager";
import { Badge, Card, EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatCAD } from "@/lib/money";
import { parsePage } from "@/lib/paging";
import { formatDate } from "@/lib/utils";
import { listProjects } from "@/server/project-list";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "./status";

export const metadata = { title: "Jobs" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("projects.read_all");
  const showMoney = can(user.role, "financials.read") || can(user.role, "estimates.costing");
  const list = await listProjects({ page: parsePage((await searchParams).page), includeMoney: showMoney });
  return (
    <>
      <PageHeader title="Jobs" description="Every sold job, from scheduling to finished. Added automatically when a customer signs." />
      {list.rows.length === 0 ? (
        <EmptyState title="No jobs yet" description="Send a proposal from an estimate. When the customer signs it, the job appears here." />
      ) : (
        <Card>
          <Table>
            <thead><tr><th className={th}>#</th><th className={th}>Project</th><th className={th}>Status</th>{showMoney && <th className={`${th} text-right`}>Contract</th>}<th className={`${th} hidden md:table-cell`}>Start</th></tr></thead>
            <tbody>
              {list.rows.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <td className={`${td} tabular text-muted`}>{p.number}</td>
                  <td className={td}><Link href={`/projects/${p.id}`} className="font-medium hover:text-brand">{p.customer}</Link><span className="text-muted"> · {p.name.split(" – ").slice(1).join(" – ")}{p.city ? ` · ${p.city}` : ""}</span></td>
                  <td className={td}><Badge tone={PROJECT_STATUS_TONE[p.status]}>{PROJECT_STATUS_LABEL[p.status]}</Badge></td>
                  {showMoney && <td className={`${td} text-right tabular`}>{formatCAD(p.contractTotal)}</td>}
                  <td className={`${td} hidden text-muted md:table-cell`}>{p.startDate ? formatDate(p.startDate) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Pager info={list} path="/projects" />
    </>
  );
}

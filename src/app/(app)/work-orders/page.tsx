import { FileText } from "lucide-react";
import Link from "next/link";
import { Pager } from "@/components/pager";
import { Badge, Card, EmptyState, PageHeader, type Tone } from "@/components/ui";
import type { WorkOrderStatus } from "@/db/schema/work-orders";
import { requirePermission } from "@/lib/authz/guard";
import { firstParam, pageHref, parsePage } from "@/lib/paging";
import { formatDate } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/work-orders/types";
import { listAllWorkOrders } from "@/server/work-orders";

export const metadata = { title: "Work orders" };

const FILTERS: { key: "" | WorkOrderStatus; label: string }[] = [
  { key: "", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "issued", label: "Issued" },
  { key: "cancelled", label: "Cancelled" },
];
const TONE: Record<WorkOrderStatus, Tone> = { draft: "neutral", issued: "success", cancelled: "danger" };

/** Every crew work order in one place. Each opens on its job, where it is edited, issued and shared. */
export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("projects.read_all");
  const sp = await searchParams;
  const raw = firstParam(sp.status);
  const status = FILTERS.some((f) => f.key === raw) ? (raw as "" | WorkOrderStatus) : "";
  const list = await listAllWorkOrders({ status: status || undefined, page: parsePage(sp.page) });

  return (
    <>
      <PageHeader title="Work orders" description="What each crew needs on site: address, scope, colours and instructions. Open one to edit, issue or share it." />
      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={pageHref("/work-orders", { status: f.key }, 1)}
            aria-current={status === f.key ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm ${status === f.key ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {list.rows.length === 0 ? (
        <EmptyState
          title={status ? "No work orders here" : "No work orders yet"}
          description="Each sold job gets a work order automatically. Open the job to check it, assign people and issue it."
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {list.rows.map((w) => (
              <li key={w.id}>
                <Link href={`/projects/${w.projectId}#work-orders`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2" data-testid="work-order-row">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text">
                      {w.number} · {w.customerName}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      Job #{w.projectNumber} · {w.crewName ?? "All crews"}
                      {w.issuedAt ? ` · version ${w.currentVersion}, issued ${formatDate(w.issuedAt)}` : " · not issued yet"}
                      {w.activeLinks ? ` · ${w.activeLinks} share link${w.activeLinks === 1 ? "" : "s"}` : ""}
                    </span>
                  </span>
                  <Badge tone={TONE[w.status]}>{STATUS_LABEL[w.status]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Pager info={list} path="/work-orders" params={{ status }} />
    </>
  );
}

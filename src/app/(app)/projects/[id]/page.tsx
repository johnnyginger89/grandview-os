import { eq } from "drizzle-orm";
import { MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { db } from "@/db";
import { customers, PROJECT_STATUSES, projects, properties, proposals, type ProjectStatus } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { businessDate, formatIsoDate, todayIso } from "@/lib/calendar-date";
import { formatCAD, formatNum } from "@/lib/money";
import { formatAddress, formatDate, formatDateTime, mapsUrl } from "@/lib/utils";
import { isDoneStatus, listStatusEvents, type StatusEventRow } from "@/server/project-status";
import { proposalUrl } from "@/server/proposals";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "../status";
import { StatusControl, type StatusHistoryEntry } from "./status-control";

function historyEntry(e: StatusEventRow): StatusHistoryEntry {
  const label = (s: ProjectStatus) => PROJECT_STATUS_LABEL[s];
  const effective = businessDate(e.effectiveAt);
  const dateChange = e.fromStatus === e.toStatus;
  const change =
    e.source === "backfill" ? `${label(e.toStatus)} (when status history began)`
    : e.fromStatus === null ? `Started as ${label(e.toStatus)}`
    : dateChange ? `Finish date changed to ${formatIsoDate(effective)}`
    : `${label(e.fromStatus)} → ${label(e.toStatus)}`;
  // A back-dated finish or cancellation shows the day it counts from.
  const backDated = !dateChange && e.source !== "backfill" && effective !== businessDate(e.changedAt);
  return {
    id: e.id,
    change,
    when: `${formatDate(e.changedAt)}${backDated ? ` (effective ${formatIsoDate(effective)})` : ""}`,
    by: e.changedByName ?? (e.source === "import" ? "Import" : null),
    note: dateChange || e.source === "backfill" ? null : e.note,
  };
}

async function StatusCard({ p }: { p: typeof projects.$inferSelect }) {
  const history = (await listStatusEvents(p.id, 10)).map(historyEntry);
  return (
    <StatusControl
      projectId={p.id}
      status={p.status}
      options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABEL[s], done: isDoneStatus(s) }))}
      soldDate={businessDate(p.soldAt)}
      completedDate={p.completedAt ? businessDate(p.completedAt) : null}
      cancelledDate={p.cancelledAt ? businessDate(p.cancelledAt) : null}
      today={todayIso()}
      history={history}
    />
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requirePermission("projects.read_all");
  const p = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!p) notFound();
  const [customer, property, proposal] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, p.customerId) }),
    p.propertyId ? db.query.properties.findFirst({ where: eq(properties.id, p.propertyId) }) : null,
    p.proposalId ? db.query.proposals.findFirst({ where: eq(proposals.id, p.proposalId), columns: { token: true, acceptedName: true, acceptedAt: true } }) : null,
  ]);
  const showMoney = can(user.role, "financials.read") || can(user.role, "estimates.costing");
  const address = property ? formatAddress(property) : null;
  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">#{p.number} {p.name} <Badge tone={PROJECT_STATUS_TONE[p.status]}>{PROJECT_STATUS_LABEL[p.status]}</Badge></span>}
        description={address ? <a href={mapsUrl(address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline"><MapPin className="size-3.5" />{address}</a> : undefined}
      />
      {showMoney && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Contract (incl. GST)" value={formatCAD(p.contractTotal)} hint={`${formatCAD(p.contractPrice)} before GST`} />
          <Stat label="Deposit required" value={formatCAD(p.depositRequired)} />
          <Stat label="Estimated hours" value={formatNum(p.estimatedHours, 1)} />
          <Stat label="Estimated cost" value={formatCAD(p.estimatedCost)} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contract" />
          <dl className="grid grid-cols-3 gap-y-2 p-4 text-sm">
            <dt className="text-muted">Customer</dt><dd className="col-span-2"><Link href={`/customers/${p.customerId}`} className="text-brand hover:underline">{customer?.displayName}</Link></dd>
            <dt className="text-muted">Estimate</dt><dd className="col-span-2">{p.estimateId ? <Link href={`/estimates/${p.estimateId}`} className="text-brand hover:underline">View estimate</Link> : "—"}</dd>
            <dt className="text-muted">Signed</dt><dd className="col-span-2">{proposal?.acceptedAt ? `${proposal.acceptedName}, ${formatDateTime(proposal.acceptedAt)}` : "—"}</dd>
            {proposal && <><dt className="text-muted">Signed copy</dt><dd className="col-span-2"><a href={proposalUrl(proposal.token)} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open signed proposal</a></dd></>}
          </dl>
        </Card>
        {can(user.role, "projects.write") && <StatusCard p={p} />}
        <Card>
          <CardHeader title="Next steps" />
          <ul className="list-disc space-y-1 p-4 pl-8 text-sm text-muted">
            <li>Collect the deposit and confirm the start date.</li>
            <li>Scheduling, work orders and invoicing for projects are being added next.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

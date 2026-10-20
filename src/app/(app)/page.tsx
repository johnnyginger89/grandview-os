import { and, asc, count, eq, gte, isNull, lte, sum } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { db } from "@/db";
import { customers, estimates, opportunities, pipelineStages, properties } from "@/db/schema";
import { requireUser } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatCAD } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser();
  if (!can(user.role, "dashboard.view")) redirect("/my-jobs");

  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [[toContact], [followUps], visits, [proposals], [wonMonth], [created30], [won30]] = await Promise.all([
    db.select({ n: count() }).from(opportunities).innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId)).where(eq(pipelineStages.key, "new_lead")),
    db.select({ n: count() }).from(opportunities).innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId)).where(and(eq(pipelineStages.kind, "open"), lte(opportunities.nextFollowUpAt, now))),
    db
      .select({ id: opportunities.id, at: opportunities.estimateVisitAt, name: customers.displayName, city: properties.city, types: opportunities.projectTypes })
      .from(opportunities)
      .innerJoin(customers, eq(customers.id, opportunities.customerId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(properties, eq(properties.id, opportunities.propertyId))
      .where(and(eq(pipelineStages.key, "estimate_booked"), gte(opportunities.estimateVisitAt, new Date(now.getTime() - 12 * 3_600_000)), lte(opportunities.estimateVisitAt, week)))
      .orderBy(asc(opportunities.estimateVisitAt)),
    db.select({ n: count(), value: sum(estimates.totalPrice) }).from(estimates).where(eq(estimates.status, "sent")),
    db.select({ n: count(), value: sum(estimates.totalPrice) }).from(estimates).where(and(eq(estimates.status, "accepted"), gte(estimates.acceptedAt, monthStart))),
    db.select({ n: count() }).from(opportunities).where(gte(opportunities.createdAt, new Date(now.getTime() - 30 * 86_400_000))),
    db.select({ n: count() }).from(opportunities).where(gte(opportunities.wonAt, new Date(now.getTime() - 30 * 86_400_000))),
  ]);

  const newUnviewed = await db
    .select({ id: opportunities.id, name: customers.displayName, createdAt: opportunities.createdAt, types: opportunities.projectTypes })
    .from(opportunities)
    .innerJoin(customers, eq(customers.id, opportunities.customerId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(pipelineStages.key, "new_lead"), isNull(opportunities.firstViewedAt)))
    .orderBy(asc(opportunities.createdAt))
    .limit(8);

  const showMoney = can(user.role, "estimates.read");

  return (
    <>
      <PageHeader title={`Good ${now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}`} description="What needs attention today." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Leads to contact" value={toContact.n} tone={toContact.n > 0 ? "danger" : undefined} hint={<Link href="/leads" className="text-brand hover:underline">Open pipeline</Link>} />
        <Stat label="Follow-ups due" value={followUps.n} />
        <Stat label="Proposals out" value={proposals.n} hint={showMoney ? formatCAD(proposals.value ?? 0) : undefined} />
        <Stat label="Won this month" value={wonMonth.n} hint={showMoney ? formatCAD(wonMonth.value ?? 0) : undefined} tone="success" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Estimate visits – next 7 days" />
          <ul className="divide-y divide-border text-sm">
            {visits.map((v) => (
              <li key={v.id}><Link href={`/leads/${v.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2">
                <span><span className="font-medium">{v.name}</span><span className="text-muted"> · {[v.types.join(", "), v.city].filter(Boolean).join(" · ")}</span></span>
                <span className="shrink-0 text-xs text-info">{formatDateTime(v.at)}</span>
              </Link></li>
            ))}
            {visits.length === 0 && <li className="px-4 py-3 text-muted">No visits booked in the next week.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="New leads not yet opened" description={`${created30.n} leads in the last 30 days · ${won30.n} won`} />
          <ul className="divide-y divide-border text-sm">
            {newUnviewed.map((l) => (
              <li key={l.id}><Link href={`/leads/${l.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2">
                <span className="font-medium">{l.name}<span className="font-normal text-muted"> · {l.types.join(", ")}</span></span>
                <span className="shrink-0 text-xs text-subtle">{formatDateTime(l.createdAt)}</span>
              </Link></li>
            ))}
            {newUnviewed.length === 0 && <li className="px-4 py-3 text-muted">All caught up.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}

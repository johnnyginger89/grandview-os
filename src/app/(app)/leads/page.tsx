import { and, asc, eq, gte, or } from "drizzle-orm";
import { Plus } from "lucide-react";
import { LinkButton, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { customers, opportunities, pipelineStages, properties } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { getList } from "@/server/settings";
import { PipelineBoard, type BoardCard } from "./pipeline-board";

export const metadata = { title: "Leads & Pipeline" };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

export default async function LeadsPage() {
  const user = await requirePermission("pipeline.read");
  const since = daysAgo(30);
  const [stages, rows, lostReasons] = await Promise.all([
    db.select().from(pipelineStages).orderBy(asc(pipelineStages.position)),
    db
      .select({
        id: opportunities.id,
        number: opportunities.number,
        title: opportunities.title,
        stageId: opportunities.stageId,
        stageChangedAt: opportunities.stageChangedAt,
        estimateVisitAt: opportunities.estimateVisitAt,
        firstViewedAt: opportunities.firstViewedAt,
        nextFollowUpAt: opportunities.nextFollowUpAt,
        projectTypes: opportunities.projectTypes,
        estimatedValue: opportunities.estimatedValue,
        channel: opportunities.channel,
        customerName: customers.displayName,
        city: properties.city,
        kind: pipelineStages.kind,
      })
      .from(opportunities)
      .innerJoin(customers, eq(customers.id, opportunities.customerId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(properties, eq(properties.id, opportunities.propertyId))
      .where(or(eq(pipelineStages.kind, "open"), and(gte(opportunities.closedAt, since))))
      .orderBy(asc(opportunities.stageChangedAt)),
    getList("lost_reasons"),
  ]);

  const cards: BoardCard[] = rows.map((r) => ({
    ...r,
    stageChangedAt: r.stageChangedAt.toISOString(),
    estimateVisitAt: r.estimateVisitAt?.toISOString() ?? null,
    firstViewedAt: r.firstViewedAt?.toISOString() ?? null,
    nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Leads & Pipeline"
        description="Drag cards between stages, or change the stage on the lead. Won and lost show the last 30 days."
        actions={can(user.role, "pipeline.write") && (
          <LinkButton href="/leads/new"><Plus className="size-4" /> New lead</LinkButton>
        )}
      />
      <PipelineBoard stages={stages} cards={cards} lostReasons={lostReasons} canEdit={can(user.role, "pipeline.write")} />
    </>
  );
}

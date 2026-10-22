import "server-only";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { activities, estimates, opportunities, pipelineStages, proposals } from "@/db/schema";
import { audit } from "./audit";
import { lockEstimate } from "./estimates";
import { advanceToProposalSent, moveStage, stageByKey } from "./leads";

/*
 * Every estimate belongs to a lead, so the lead moves with it (proposal sent, won) and the sale
 * counts in the sales figures. Estimates started from the customer page or "+" pick the
 * customer's open lead; an estimate that missed it can be linked from the estimate itself.
 */

export class EstimateLeadError extends Error {
  readonly expose = true;
}

export interface LeadChoice {
  id: string;
  number: number;
  title: string;
  stage: string;
  projectTypes: string[];
}

export interface LeadSummary extends LeadChoice {
  /** "open", "won" or "lost". */
  stageKind: string;
  /** What the customer asked for, in their words or the office's. */
  description: string | null;
  timeline: string | null;
  visitAt: Date | null;
}

const choiceColumns = {
  id: opportunities.id,
  number: opportunities.number,
  title: opportunities.title,
  stage: pipelineStages.name,
  projectTypes: opportunities.projectTypes,
};

/** The customer's leads still in play (not won or lost), most recently active first. */
export async function openLeadsFor(customerId: string): Promise<LeadChoice[]> {
  return db
    .select(choiceColumns)
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(opportunities.customerId, customerId), eq(pipelineStages.kind, "open")))
    .orderBy(desc(opportunities.updatedAt), desc(opportunities.number))
    .limit(20);
}

/** The lead as the estimate editor shows it. */
export async function leadSummary(opportunityId: string): Promise<LeadSummary | null> {
  const [row] = await db
    .select({ ...choiceColumns, stageKind: pipelineStages.kind, description: opportunities.description, timeline: opportunities.timeline, visitAt: opportunities.estimateVisitAt })
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  return row ?? null;
}

/**
 * Links the estimate to one of its customer's open leads, or unlinks it (null). A sold estimate
 * keeps its lead. Changes nothing the customer sees, so the estimate's version stays the same.
 */
export async function linkEstimateToLead(estimateId: string, opportunityId: string | null, userId: string): Promise<void> {
  const linked = await db.transaction(async (tx) => {
    const est = await lockEstimate(tx, estimateId);
    if (!est) throw new EstimateLeadError("Estimate not found.");
    if (est.status === "accepted") throw new EstimateLeadError("This estimate is sold, so its lead can't change.");
    if (est.opportunityId === opportunityId) return null;

    const lead = async (id: string) =>
      (
        await tx
          .select({ id: opportunities.id, number: opportunities.number, customerId: opportunities.customerId, propertyId: opportunities.propertyId, kind: pipelineStages.kind })
          .from(opportunities)
          .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
          .where(eq(opportunities.id, id))
          .limit(1)
      )[0];
    const next = opportunityId ? await lead(opportunityId) : null;
    if (opportunityId) {
      if (!next || next.customerId !== est.customerId) throw new EstimateLeadError("That lead isn't this customer's. Refresh the page and pick again.");
      if (next.kind !== "open") throw new EstimateLeadError("That lead is closed (won or lost). Pick an open one.");
    }
    const previous = est.opportunityId ? await lead(est.opportunityId) : null;

    // The lead's address, when the estimate has none yet.
    await tx
      .update(estimates)
      .set({ opportunityId, ...(next?.propertyId && !est.propertyId ? { propertyId: next.propertyId } : {}) })
      .where(eq(estimates.id, estimateId));
    if (previous) {
      await tx.insert(activities).values({ customerId: est.customerId, opportunityId: previous.id, type: "estimate", body: `Estimate #${est.number} moved off lead #${previous.number}`, createdBy: userId });
    }
    if (next) {
      await tx.insert(activities).values({ customerId: est.customerId, opportunityId: next.id, type: "estimate", body: `Estimate #${est.number} linked to lead #${next.number}`, createdBy: userId });
    }
    await audit({ actorId: userId, action: "estimate.lead", entityType: "estimate", entityId: estimateId, before: { opportunityId: est.opportunityId }, after: { opportunityId } }, tx);
    return next ? { opportunityId: next.id, sent: est.status === "sent" } : null;
  });
  // A proposal already out: the lead catches up, as if it had been sent with the link in place.
  if (linked?.sent) await advanceToProposalSent(linked.opportunityId, userId);
}

/**
 * After a decline: the estimate's lead moves to Lost, for `reason` (one of Settings → Lists →
 * Lost reasons). Its other open quotes close with it (see moveStageInTx).
 */
export async function markEstimateLeadLost(estimateId: string, reason: string, userId: string): Promise<void> {
  const est = await db.query.estimates.findFirst({ where: eq(estimates.id, estimateId), columns: { opportunityId: true, status: true } });
  if (!est?.opportunityId) throw new EstimateLeadError("This estimate isn't linked to a lead.");
  if (est.status === "accepted") throw new EstimateLeadError("This estimate is sold, so its lead stays won.");
  await moveStage(est.opportunityId, (await stageByKey("lost")).id, userId, reason);
}

/** Other estimates on the same lead with a proposal the customer could still sign, by number. */
export async function otherOpenQuotes(estimateId: string, opportunityId: string): Promise<number[]> {
  const rows = await db
    .selectDistinct({ number: estimates.number })
    .from(estimates)
    .innerJoin(proposals, eq(proposals.estimateId, estimates.id))
    .where(and(eq(estimates.opportunityId, opportunityId), ne(estimates.id, estimateId), inArray(proposals.status, ["sent", "viewed"])))
    .orderBy(asc(estimates.number));
  return rows.map((r) => r.number);
}

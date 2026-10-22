/**
 * What happens to quotes and leads when a sale is won or lost, on a real database
 * (`pnpm test:db`). Audit A-SAL-10, A-EST-7 and A-EST-8: a lost lead's quotes stop accepting
 * signatures, a quote marked sent moves its lead, a decline can move the lead to Lost, and
 * selling one quote closes the other quotes on the same lead.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { estimates, opportunities, pipelineStages, properties, proposals } from "@/db/schema";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";
import { createTestUser, uniqueTag } from "@/test/db/fixtures";
import { createCustomer } from "./customers";
import { markEstimateLeadLost, otherOpenQuotes } from "./estimate-lead";
import { createEstimate, loadEstimate, saveEstimateDoc, setEstimateStatus } from "./estimates";
import { moveStage, stageByKey } from "./leads";
import { acceptProposalForCustomer } from "./proposals";

let owner: { id: string; name: string };

beforeAll(async () => {
  owner = await createTestUser("owner", "Lead outcomes owner");
});

const WALLS: RateSnapshot = {
  rateId: null, rateVersion: null, name: "[TEST DATA] Walls", unit: "sqft", basis: "units_per_hour", productionRate: "200", additionalCoatFactor: "1", defaultCoats: 1,
  laborCostPerHour: "40", billingRatePerHour: "80", material: null, materialWastePct: "0", otherCostPerUnit: "0", category: "[TEST DATA]", customerLabel: null, proposalGroup: null,
};

/** A customer with an address and a lead at `stage`. */
async function customerWithLead(stage = "proposal_sent") {
  const tag = uniqueTag();
  const c = await createCustomer({ displayName: `[TEST DATA] Outcomes ${tag}`, email: `outcomes-${tag}@example.com` }, null, { street: `[TEST DATA] ${tag} Main St` }, owner.id);
  const place = await db.query.properties.findFirst({ where: eq(properties.customerId, c.id) });
  const [lead] = await db.insert(opportunities).values({ title: "[TEST DATA] Painting", customerId: c.id, propertyId: place!.id, stageId: (await stageByKey(stage)).id }).returning();
  return { customerId: c.id, leadId: lead.id };
}

/** An estimate on the lead with one priced surface. */
async function quote(customerId: string, leadId: string) {
  const est = await createEstimate({ customerId, opportunityId: leadId }, owner.id);
  const { doc } = (await loadEstimate(est.id))!;
  const areaId = randomUUID();
  const priced: EstimateDoc = {
    ...doc,
    areas: [{ id: areaId, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null }],
    lines: [
      { id: randomUUID(), areaId, description: "Walls", rateSnapshot: WALLS, quantity: "400", quantitySource: "manual", coats: 1, prepFactor: "1", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", overrideHours: null, overridePrice: null, isOptional: false, optionSelected: false },
    ],
  };
  await saveEstimateDoc(est.id, priced);
  return est;
}

/** A proposal the customer could sign, as sending makes one. */
async function openProposal(estimateId: string, status: "sent" | "viewed" | "declined" = "sent") {
  const { doc } = (await loadEstimate(estimateId))!;
  const [p] = await db
    .insert(proposals)
    .values({ estimateId, revision: 1, token: randomBytes(24).toString("base64url"), status, snapshot: doc, view: { version: 2 }, sentTo: "[TEST DATA]@example.com" })
    .returning();
  return p;
}

const statusOf = async (proposalId: string) => (await db.query.proposals.findFirst({ where: eq(proposals.id, proposalId) }))?.status;
const stageOf = async (leadId: string) =>
  (await db.select({ key: pipelineStages.key }).from(opportunities).innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId)).where(eq(opportunities.id, leadId)))[0]?.key;

describe("a lead marked Lost", () => {
  it("withdraws its quotes' open proposals and leaves the others as they were", async () => {
    const { customerId, leadId } = await customerWithLead();
    const a = await quote(customerId, leadId);
    const b = await quote(customerId, leadId);
    const sent = await openProposal(a.id, "sent");
    const viewed = await openProposal(b.id, "viewed");
    const declined = await openProposal(b.id, "declined");
    const elsewhere = await openProposal((await quote(customerId, (await customerWithLead()).leadId)).id);

    await moveStage(leadId, (await stageByKey("lost")).id, owner.id, "Price");

    expect(await statusOf(sent.id)).toBe("withdrawn");
    expect(await statusOf(viewed.id)).toBe("withdrawn");
    expect(await statusOf(declined.id)).toBe("declined");
    expect(await statusOf(elsewhere.id)).toBe("sent");
  });
});

describe("the lead follows its quote", () => {
  it("moves to Proposal sent when the quote is marked sent without emailing", async () => {
    const { customerId, leadId } = await customerWithLead("estimate_completed");
    const est = await quote(customerId, leadId);
    await setEstimateStatus(est.id, "sent", owner.id);
    expect(await stageOf(leadId)).toBe("proposal_sent");
  });

  it("moves to Lost with the reason after a decline, closing the lead's other quotes", async () => {
    const { customerId, leadId } = await customerWithLead();
    const declinedQuote = await quote(customerId, leadId);
    await db.update(estimates).set({ status: "declined" }).where(eq(estimates.id, declinedQuote.id));
    const alternative = await openProposal((await quote(customerId, leadId)).id);

    await markEstimateLeadLost(declinedQuote.id, "Went with another contractor", owner.id);

    const lead = await db.query.opportunities.findFirst({ where: eq(opportunities.id, leadId) });
    expect(await stageOf(leadId)).toBe("lost");
    expect(lead?.lostReason).toBe("Went with another contractor");
    expect(await statusOf(alternative.id)).toBe("withdrawn");
  });

  it("can't move a lead the estimate isn't linked to", async () => {
    const { customerId } = await customerWithLead();
    const loose = await createEstimate({ customerId }, owner.id);
    await expect(markEstimateLeadLost(loose.id, "Price", owner.id)).rejects.toThrow("This estimate isn't linked to a lead.");
  });
});

describe("selling one quote on a lead", () => {
  it("lists the other open quotes first, then closes them when it's accepted", async () => {
    const { customerId, leadId } = await customerWithLead();
    const chosen = await quote(customerId, leadId);
    const alternative = await quote(customerId, leadId);
    const altProposal = await openProposal(alternative.id);
    const declinedAlt = await openProposal((await quote(customerId, leadId)).id, "declined");

    expect(await otherOpenQuotes(chosen.id, leadId)).toEqual([alternative.number]);

    await acceptProposalForCustomer(chosen.id, { name: "[TEST DATA] Phone Customer", method: "phone" }, owner);

    expect(await statusOf(altProposal.id)).toBe("withdrawn");
    expect(await statusOf(declinedAlt.id)).toBe("declined");
    const sold = await db.query.proposals.findFirst({ where: and(eq(proposals.estimateId, chosen.id), eq(proposals.status, "accepted")) });
    expect(sold).toBeTruthy();
    expect(await otherOpenQuotes(chosen.id, leadId)).toEqual([]);
  });
});

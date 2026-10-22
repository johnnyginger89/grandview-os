/**
 * Estimates and their leads on a real database (`pnpm test:db`): the customer's open leads are
 * offered newest first, linking checks the lead is this customer's and still open, and a sent
 * estimate brings its newly linked lead up to "Proposal sent". Audit A-SAL-3.
 */
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { activities, auditLog, estimates, opportunities, pipelineStages, properties } from "@/db/schema";
import { createTestUser, uniqueTag } from "@/test/db/fixtures";
import { createCustomer } from "./customers";
import { linkEstimateToLead, openLeadsFor } from "./estimate-lead";
import { createEstimate } from "./estimates";
import { stageByKey } from "./leads";

let ownerId: string;

beforeAll(async () => {
  ownerId = (await createTestUser("owner", "Lead link owner")).id;
});

async function customer() {
  const tag = uniqueTag();
  return createCustomer({ displayName: `[TEST DATA] Lead Link ${tag}`, email: `leadlink-${tag}@example.com` }, null, null, ownerId);
}

async function lead(customerId: string, stage: string, opts: { projectTypes?: string[]; propertyId?: string | null; updatedAt?: Date } = {}) {
  const s = await stageByKey(stage);
  const [row] = await db
    .insert(opportunities)
    .values({ title: "[TEST DATA] Painting", customerId, stageId: s.id, projectTypes: opts.projectTypes ?? ["Interior"], propertyId: opts.propertyId ?? null, updatedAt: opts.updatedAt ?? new Date() })
    .returning();
  return row;
}

const stageOf = async (opportunityId: string) =>
  (await db.select({ key: pipelineStages.key }).from(opportunities).innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId)).where(eq(opportunities.id, opportunityId)))[0]?.key;

describe("openLeadsFor", () => {
  it("lists the customer's open leads, most recently active first, and leaves out won and lost ones", async () => {
    const c = await customer();
    const older = await lead(c.id, "contacted", { updatedAt: new Date("2026-10-01T17:00:00Z") });
    const newer = await lead(c.id, "estimate_booked", { projectTypes: ["Exterior", "Deck / Fence Staining"], updatedAt: new Date("2026-10-20T17:00:00Z") });
    await lead(c.id, "won");
    await lead(c.id, "lost");
    await lead((await customer()).id, "contacted");

    const found = await openLeadsFor(c.id);
    expect(found.map((l) => l.id)).toEqual([newer.id, older.id]);
    expect(found[0]).toMatchObject({ number: newer.number, stage: "Estimate Booked", projectTypes: ["Exterior", "Deck / Fence Staining"] });
  });
});

describe("linkEstimateToLead", () => {
  it("links an estimate started from the customer page, takes the lead's address, and records it", async () => {
    const c = await customer();
    const [place] = await db.insert(properties).values({ customerId: c.id, street: "[TEST DATA] 12 Lead Lane", city: "Vancouver" }).returning();
    const est = await createEstimate({ customerId: c.id, jobType: "interior" }, ownerId);
    // The address was added after the estimate was started, with the lead.
    await db.update(estimates).set({ propertyId: null }).where(eq(estimates.id, est.id));
    const l = await lead(c.id, "estimate_booked", { propertyId: place.id });

    await linkEstimateToLead(est.id, l.id, ownerId);

    const after = await db.query.estimates.findFirst({ where: eq(estimates.id, est.id) });
    expect(after).toMatchObject({ opportunityId: l.id, propertyId: place.id, updatedAt: est.updatedAt });
    const note = await db.query.activities.findFirst({ where: and(eq(activities.opportunityId, l.id), eq(activities.type, "estimate")), orderBy: desc(activities.createdAt) });
    expect(note?.body).toBe(`Estimate #${est.number} linked to lead #${l.number}`);
    const entry = await db.query.auditLog.findFirst({ where: and(eq(auditLog.entityId, est.id), eq(auditLog.action, "estimate.lead")) });
    expect(entry).toMatchObject({ actorId: ownerId, before: { opportunityId: null }, after: { opportunityId: l.id } });
    // Not sent yet, so the lead stays where it is.
    expect(await stageOf(l.id)).toBe("estimate_booked");
  });

  it("brings the lead up to Proposal sent when the estimate is already out, and never moves it back", async () => {
    const c = await customer();
    const est = await createEstimate({ customerId: c.id }, ownerId);
    await db.update(estimates).set({ status: "sent" }).where(eq(estimates.id, est.id));
    const early = await lead(c.id, "estimate_completed");
    await linkEstimateToLead(est.id, early.id, ownerId);
    expect(await stageOf(early.id)).toBe("proposal_sent");

    const later = await lead(c.id, "follow_up");
    await linkEstimateToLead(est.id, later.id, ownerId);
    expect(await stageOf(later.id)).toBe("follow_up");
    const moved = await db.query.activities.findFirst({ where: and(eq(activities.opportunityId, early.id), eq(activities.type, "estimate")), orderBy: desc(activities.createdAt) });
    expect(moved?.body).toBe(`Estimate #${est.number} moved off lead #${early.number}`);
  });

  it("refuses another customer's lead, a closed lead and a sold estimate, and can unlink", async () => {
    const c = await customer();
    const est = await createEstimate({ customerId: c.id }, ownerId);
    const theirs = await lead((await customer()).id, "contacted");
    await expect(linkEstimateToLead(est.id, theirs.id, ownerId)).rejects.toThrow("That lead isn't this customer's.");
    const won = await lead(c.id, "won");
    await expect(linkEstimateToLead(est.id, won.id, ownerId)).rejects.toThrow("That lead is closed (won or lost).");

    const open = await lead(c.id, "contacted");
    await linkEstimateToLead(est.id, open.id, ownerId);
    await linkEstimateToLead(est.id, null, ownerId);
    expect((await db.query.estimates.findFirst({ where: eq(estimates.id, est.id) }))?.opportunityId).toBeNull();

    await db.update(estimates).set({ status: "accepted", opportunityId: open.id }).where(eq(estimates.id, est.id));
    await expect(linkEstimateToLead(est.id, null, ownerId)).rejects.toThrow("This estimate is sold, so its lead can't change.");
  });
});

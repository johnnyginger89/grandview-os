/**
 * Booking the estimate visit from the lead (audit A-SAL-12), on a real database (`pnpm test:db`):
 * it counts like a YouCanBook.me booking, keeps the first booking time when moved, and never
 * moves a lead backwards or reopens a closed one.
 */
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { activities, opportunities, pipelineStages } from "@/db/schema";
import { createTestUser, uniqueTag } from "@/test/db/fixtures";
import { createCustomer } from "./customers";
import { bookVisit, stageByKey } from "./leads";

let ownerId: string;

beforeAll(async () => {
  ownerId = (await createTestUser("owner", "Visit owner")).id;
});

async function lead(stage: string) {
  const tag = uniqueTag();
  const c = await createCustomer({ displayName: `[TEST DATA] Visit ${tag}`, email: `visit-${tag}@example.com` }, null, null, ownerId);
  const [row] = await db.insert(opportunities).values({ title: "[TEST DATA] Painting", customerId: c.id, stageId: (await stageByKey(stage)).id }).returning();
  return row;
}

const read = async (id: string) =>
  (await db.select({ opp: opportunities, stage: pipelineStages.key }).from(opportunities).innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId)).where(eq(opportunities.id, id)))[0];
const lastNote = async (id: string) => (await db.query.activities.findFirst({ where: and(eq(activities.opportunityId, id), eq(activities.type, "booking")), orderBy: desc(activities.createdAt) }))?.body;

describe("bookVisit", () => {
  it("books the visit, counts the booking and moves the lead to Estimate booked", async () => {
    const l = await lead("contacted");
    const at = new Date("2026-11-05T17:00:00Z"); // 10 am in Vancouver
    await bookVisit(l.id, at, ownerId);
    const r = await read(l.id);
    expect(r.stage).toBe("estimate_booked");
    expect(r.opp.estimateVisitAt).toEqual(at);
    expect(r.opp.visitBookedAt).toBeInstanceOf(Date);
    expect(await lastNote(l.id)).toMatch(/^Estimate visit booked for Nov 5, 2026, 10:00/);
  });

  it("moving the visit keeps when it was first booked", async () => {
    const l = await lead("new_lead");
    await bookVisit(l.id, new Date("2026-11-05T17:00:00Z"), ownerId);
    const first = (await read(l.id)).opp.visitBookedAt;
    await bookVisit(l.id, new Date("2026-11-06T21:30:00Z"), ownerId);
    const r = await read(l.id);
    expect(r.opp.estimateVisitAt).toEqual(new Date("2026-11-06T21:30:00Z"));
    expect(r.opp.visitBookedAt).toEqual(first);
    expect(await lastNote(l.id)).toMatch(/^Estimate visit moved to Nov 6, 2026, 2:30/);
  });

  it("leaves a lead past the visit where it is, and refuses a closed one", async () => {
    const quoted = await lead("proposal_sent");
    await bookVisit(quoted.id, new Date("2026-11-05T17:00:00Z"), ownerId);
    expect((await read(quoted.id)).stage).toBe("proposal_sent");

    const lost = await lead("lost");
    await expect(bookVisit(lost.id, new Date("2026-11-05T17:00:00Z"), ownerId)).rejects.toThrow("This lead is closed.");
    expect((await read(lost.id)).opp.estimateVisitAt).toBeNull();
  });
});

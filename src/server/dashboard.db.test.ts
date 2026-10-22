/**
 * The Home and Performance figures on a real database (`pnpm test:db`): the raw SQL in
 * dashboard.ts run over leads, quotes and jobs with known prices and dates, through the
 * same calls the two pages make.
 *
 * Other *.db.test.ts files share the database, so company-wide figures are checked as the
 * change this file's rows make (read before and after they go in). The salesperson's row
 * is checked whole: only this file's leads belong to that salesperson.
 *
 * Times are written in UTC with the Vancouver time beside them: UTC−7 for every date here
 * (summer time until 2026-11-01, and from then on BC stays on UTC−7 for good).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { estimateRevisions, estimates, opportunities, pipelineStages, projects, proposals, type EstimateStatus, type ProposalStatus } from "@/db/schema";
import { d } from "@/lib/money";
import { resolvePeriod } from "@/lib/reporting/periods";
import type { PerformanceDTO, SnapshotDTO } from "@/lib/reporting/types";
import { createTestUser, uniqueTag } from "@/test/db/fixtures";
import { createCustomer } from "./customers";
import { accessFor, getMonthSnapshot, getPerformance, type PerformanceAccess } from "./dashboard";
import { getGoals } from "./goals";
import { changeProjectStatus, createSoldProject } from "./project-status";

const NOW = new Date("2026-10-20T19:00:00Z"); // Tue Oct 20, 12:00 in Vancouver
const NOW_DEC = new Date("2026-12-10T20:00:00Z"); // Thu Dec 10, 13:00 in Vancouver

const periodOf = (preset: "this_month" | "last_month", now: Date, fiscalYearStartMonth = 1) =>
  resolvePeriod({ preset, compare: "prior" }, now, { fiscalYearStartMonth }).period;

interface Views {
  /** Home, "This month": Oct 1–20 against Sep 1–20. */
  home: SnapshotDTO;
  /** Performance, this month: Oct 1–20 against Sep 1–20. */
  oct: PerformanceDTO;
  /** Performance, last month: September against August. */
  sep: PerformanceDTO;
  /** Performance on Dec 10, last month: November against October. */
  nov: PerformanceDTO;
  /** Performance on Dec 10, this month: Dec 1–10. */
  dec: PerformanceDTO;
}

/** What the Home and Performance pages would show (the same calls they make). */
async function views(access: PerformanceAccess): Promise<Views> {
  const goals = await getGoals();
  const performance = (preset: "this_month" | "last_month", now: Date) => getPerformance(periodOf(preset, now, goals.fiscalYearStartMonth), access, { goals, now });
  return {
    home: await getMonthSnapshot(NOW, access),
    oct: await performance("this_month", NOW),
    sep: await performance("last_month", NOW),
    nov: await performance("last_month", NOW_DEC),
    dec: await performance("this_month", NOW_DEC),
  };
}

let seller: { id: string; name: string };
let before: Views;
let after: Views;

beforeAll(async () => {
  const tag = uniqueTag();
  const owner = await createTestUser("owner", "Dashboard owner");
  seller = await createTestUser("estimator", "Dashboard salesperson");
  before = await views(accessFor("owner"));
  await createScenario(tag, owner.id, seller.id);
  after = await views(accessFor("owner"));
});

/**
 * Leads (all the salesperson's), quotes and jobs:
 *
 *   lead "Won"          created Sep 10, visit booked Sep 11 and done Sep 15, won Oct 5
 *                         quote $12,000 sent Sep 20, accepted → job sold Oct 5, $12,000 (cost $7,000)
 *   lead "Late night"   created 23:30 Sep 30, still open, estimated at $2,500, never quoted
 *   lead "Lost"         created Oct 2, quote $6,000 sent Oct 6 and declined, lost on price Oct 12
 *   lead "Spam"         created Oct 3, lost as "Spam / wrong number" (excluded from lead counts)
 *   lead "Quoted"       created Oct 8, visit booked Oct 8 and done Oct 10, quote $9,000 sent Oct 11,
 *                         revised to $9,500 and re-sent Oct 14, viewed, open until Nov 13
 *   lead "New"          created Oct 15, estimated at $4,000, not contacted yet
 *
 *   job sold 00:30 Oct 1   $3,000 (cost $1,800), not finished
 *   job sold 23:30 Sep 30  $2,000, finished Oct 10
 *   job sold 23:30 Aug 31  $1,500, finished 23:45 Sep 30
 *   job sold Sep 10        $4,000, cancelled Oct 7
 *   job sold Sep 25        $6,000, on hold
 *   job sold 23:30 Nov 30  $700
 *   job sold 00:30 Dec 1   $800
 */
async function createScenario(tag: string, ownerId: string, sellerId: string) {
  const at = (iso: string) => new Date(iso);
  const customer = await createCustomer({ displayName: `[TEST DATA] Dashboard customer ${tag}` }, null, null, ownerId);
  const stage = new Map((await db.select({ key: pipelineStages.key, id: pipelineStages.id }).from(pipelineStages)).map((s) => [s.key, s.id]));

  const lead = async (name: string, v: { stage: string; created: string; value?: string; booked?: string; visited?: string; closed?: string; lostReason?: string }) => {
    const [row] = await db
      .insert(opportunities)
      .values({
        title: `[TEST DATA] ${name} ${tag}`,
        customerId: customer.id,
        stageId: stage.get(v.stage)!,
        estimatorId: sellerId,
        createdBy: ownerId,
        createdAt: at(v.created),
        estimatedValue: v.value ?? null,
        visitBookedAt: v.booked ? at(v.booked) : null,
        visitCompletedAt: v.visited ? at(v.visited) : null,
        closedAt: v.closed ? at(v.closed) : null,
        wonAt: v.stage === "won" && v.closed ? at(v.closed) : null,
        lostReason: v.lostReason ?? null,
      })
      .returning();
    return row.id;
  };

  /** An estimate and the proposal sent for each of its revisions, at the price that revision quoted. */
  const quote = async (leadId: string, status: EstimateStatus, sent: { price: string; at: string; status: ProposalStatus; expires?: string }[]) => {
    const [est] = await db
      .insert(estimates)
      .values({
        title: `[TEST DATA] Estimate ${tag}`,
        customerId: customer.id,
        opportunityId: leadId,
        status,
        revision: sent.length,
        estimatorId: sellerId,
        createdBy: ownerId,
        createdAt: at(sent[0].at),
        pricingMethod: "billing_rate",
        laborCostPerHour: "45.00",
        billingRatePerHour: "80.00",
        targetMargin: "0.4500",
        materialMarkupPct: "0.2000",
        minimumJobPrice: "2000.00",
        gstRate: "0.0500",
        depositPct: "0.2000",
      })
      .returning();
    const proposalIds: string[] = [];
    for (const [i, s] of sent.entries()) {
      await db.insert(estimateRevisions).values({ estimateId: est.id, revision: i + 1, snapshot: {}, totals: { price: s.price }, createdBy: ownerId, createdAt: at(s.at) });
      const [p] = await db
        .insert(proposals)
        .values({ estimateId: est.id, revision: i + 1, token: randomUUID(), status: s.status, snapshot: {}, view: {}, sentBy: ownerId, sentAt: at(s.at), expiresAt: s.expires ? at(s.expires) : null })
        .returning();
      proposalIds.push(p.id);
    }
    return { estimateId: est.id, proposalId: proposalIds[0] };
  };

  /** A sold job, created the way a signed proposal creates one. */
  const job = async (name: string, v: { sold: string; price: string; cost: string; leadId?: string; estimateId?: string; proposalId?: string }) => {
    const p = await createSoldProject(
      {
        name: `[TEST DATA] ${name} ${tag}`,
        customerId: customer.id,
        opportunityId: v.leadId ?? null,
        estimateId: v.estimateId ?? null,
        proposalId: v.proposalId ?? null,
        contractPrice: v.price,
        contractTotal: d(v.price).times("1.05").toFixed(2),
        estimatedCost: v.cost,
      },
      { soldAt: at(v.sold), actorId: ownerId },
    );
    return p!.id;
  };

  const won = await lead("Won", { stage: "won", created: "2026-09-10T16:00:00Z", value: "10000.00", booked: "2026-09-11T17:00:00Z", visited: "2026-09-15T18:00:00Z", closed: "2026-10-05T18:00:00Z" });
  await lead("Late night", { stage: "contacted", created: "2026-10-01T06:30:00Z", value: "2500.00" }); // 23:30 Sep 30
  const lost = await lead("Lost", { stage: "lost", created: "2026-10-02T16:00:00Z", value: "5000.00", closed: "2026-10-12T18:00:00Z", lostReason: "Price" });
  await lead("Spam", { stage: "lost", created: "2026-10-03T16:00:00Z", closed: "2026-10-04T18:00:00Z", lostReason: "Spam / wrong number" });
  const quoted = await lead("Quoted", { stage: "proposal_sent", created: "2026-10-08T16:00:00Z", value: "8000.00", booked: "2026-10-08T17:00:00Z", visited: "2026-10-10T18:00:00Z" });
  await lead("New", { stage: "new_lead", created: "2026-10-15T16:00:00Z", value: "4000.00" });

  const wonQuote = await quote(won, "accepted", [{ price: "12000.00", at: "2026-09-20T18:00:00Z", status: "accepted" }]);
  await quote(lost, "declined", [{ price: "6000.00", at: "2026-10-06T18:00:00Z", status: "declined" }]);
  await quote(quoted, "sent", [
    { price: "9000.00", at: "2026-10-11T18:00:00Z", status: "superseded" },
    { price: "9500.00", at: "2026-10-14T18:00:00Z", status: "viewed", expires: "2026-11-13T18:00:00Z" },
  ]);

  await job("Won job", { sold: "2026-10-05T18:00:00Z", price: "12000.00", cost: "7000.00", leadId: won, ...wonQuote });
  await job("Sold 00:30 Oct 1", { sold: "2026-10-01T07:30:00Z", price: "3000.00", cost: "1800.00" });
  const sep30 = await job("Sold 23:30 Sep 30", { sold: "2026-10-01T06:30:00Z", price: "2000.00", cost: "1100.00" });
  await changeProjectStatus(sep30, "complete", { actorId: ownerId, effectiveDate: "2026-10-10" });
  const aug31 = await job("Sold 23:30 Aug 31", { sold: "2026-09-01T06:30:00Z", price: "1500.00", cost: "900.00" });
  await changeProjectStatus(aug31, "complete", { actorId: ownerId, effectiveDate: "2026-09-30" });
  // Marked complete on the evening itself: the app then records the moment of the click, 23:45.
  await db.update(projects).set({ completedAt: at("2026-10-01T06:45:00Z") }).where(eq(projects.id, aug31));
  const cancelled = await job("Cancelled", { sold: "2026-09-10T18:00:00Z", price: "4000.00", cost: "2500.00" });
  await changeProjectStatus(cancelled, "cancelled", { actorId: ownerId, effectiveDate: "2026-10-07", note: "[TEST DATA] Customer postponed" });
  const onHold = await job("On hold", { sold: "2026-09-25T18:00:00Z", price: "6000.00", cost: "3500.00" });
  await changeProjectStatus(onHold, "on_hold", { actorId: ownerId });
  await job("Sold 23:30 Nov 30", { sold: "2026-12-01T06:30:00Z", price: "700.00", cost: "400.00" });
  await job("Sold 00:30 Dec 1", { sold: "2026-12-01T07:30:00Z", price: "800.00", cost: "450.00" });
}

/** How much a money figure went up when this file's rows went in. */
const moneyUp = (pick: (v: Views) => string | null | undefined) => d(pick(after)).minus(d(pick(before))).toFixed(2);
/** How much a count went up when this file's rows went in. */
const countUp = (pick: (v: Views) => string | number | null | undefined) => Number(pick(after) ?? 0) - Number(pick(before) ?? 0);

/** One month's column of the Performance chart. */
function month(dto: PerformanceDTO, key: string) {
  const i = dto.monthly.months.findIndex((m) => m.key === key);
  if (i < 0) throw new Error(`${key} isn't on the chart`);
  const { leads, jobsSold, jobsCompleted, money } = dto.monthly;
  return { leads: leads[i], sold: jobsSold[i], completed: jobsCompleted[i], sales: money?.sales[i], produced: money?.produced[i] };
}

describe("Home: this month (Oct 1–20) against Sep 1–20", () => {
  it("sales, produced and backlog", () => {
    expect(moneyUp((v) => v.home.money!.sales.value)).toBe("15000.00"); // won job + 00:30 Oct 1
    expect(countUp((v) => v.home.counts.jobsSold.value)).toBe(2);
    expect(moneyUp((v) => v.home.money!.sales.compare)).toBe("4000.00"); // sold Sep 10, later cancelled
    expect(countUp((v) => v.home.counts.jobsSold.compare)).toBe(1);
    expect(moneyUp((v) => v.home.money!.produced.value)).toBe("2000.00"); // finished Oct 10
    expect(moneyUp((v) => v.home.money!.produced.compare)).toBe("0.00");
    // Sold and neither finished nor cancelled by now: won job, 00:30 Oct 1, on hold.
    expect(moneyUp((v) => v.home.money!.backlog)).toBe("21000.00");
    expect(countUp((v) => v.home.money!.backlogJobs)).toBe(3);
  });

  it("leads, visits booked and proposals sent", () => {
    expect(countUp((v) => v.home.counts.leads.value)).toBe(3); // not the spam lead
    expect(countUp((v) => v.home.counts.leads.compare)).toBe(1);
    expect(countUp((v) => v.home.counts.visitsBooked.value)).toBe(1);
    expect(countUp((v) => v.home.counts.visitsBooked.compare)).toBe(1);
    expect(countUp((v) => v.home.counts.proposalsSent.value)).toBe(2); // the re-sent quote counts once
    expect(countUp((v) => v.home.counts.proposalsSent.compare)).toBe(1);
  });

  it("open pipeline: quotes out at their latest price, and open leads not quoted yet", () => {
    expect(countUp((v) => v.home.pipeline.proposalsOut)).toBe(1);
    expect(moneyUp((v) => v.home.pipeline.proposalsOutValue)).toBe("9500.00");
    expect(countUp((v) => v.home.pipeline.notQuoted)).toBe(2); // late night + new
    expect(moneyUp((v) => v.home.pipeline.notQuotedEstimatedValue)).toBe("6500.00");
  });
});

describe("Performance: this month (Oct 1–20) against Sep 1–20", () => {
  it("sales, cancellations, net sales, backlog, proposals value and the last 12 months", () => {
    expect(moneyUp((v) => v.oct.money!.sales.value)).toBe("15000.00");
    expect(moneyUp((v) => v.oct.money!.cancelled.value)).toBe("4000.00");
    expect(countUp((v) => v.oct.counts.cancelledJobs.value)).toBe(1);
    expect(moneyUp((v) => v.oct.money!.netSales.value)).toBe("11000.00");
    expect(moneyUp((v) => v.oct.money!.netSales.compare)).toBe("4000.00");
    expect(moneyUp((v) => v.oct.money!.produced.value)).toBe("2000.00");
    expect(countUp((v) => v.oct.counts.jobsCompleted.value)).toBe(1);
    expect(moneyUp((v) => v.oct.money!.backlog.value)).toBe("21000.00");
    expect(countUp((v) => v.oct.counts.backlogJobs.value)).toBe(3);
    // On Sep 21: the Aug 31 job (finished Sep 30) and the Sep 10 one (cancelled Oct 7).
    expect(moneyUp((v) => v.oct.money!.backlog.compare)).toBe("5500.00");
    expect(countUp((v) => v.oct.counts.backlogJobs.compare)).toBe(2);
    expect(moneyUp((v) => v.oct.money!.backlogOnHold)).toBe("6000.00");
    expect(countUp((v) => v.oct.counts.backlogOnHoldJobs)).toBe(1);
    // $6,000 + $9,500 (the latest price of the re-sent quote); before: the $12,000 quote sent Sep 20.
    expect(moneyUp((v) => v.oct.money!.proposalsSentValue.value)).toBe("15500.00");
    expect(moneyUp((v) => v.oct.money!.proposalsSentValue.compare)).toBe("12000.00");
    // Every job sold from Nov 1, 2025 to today: not the Nov 30 and Dec 1 ones.
    expect(moneyUp((v) => v.oct.money!.goals.runRate?.trailing12)).toBe("28500.00");
    expect(countUp((v) => v.oct.counts.visitsCompleted.value)).toBe(1);
  });

  it("the salesperson's row: visits, proposals, sales, average sale and close rate", () => {
    expect(after.oct.people.find((p) => p.userId === seller.id)).toEqual({
      userId: seller.id,
      name: seller.name,
      visitsCompleted: 1,
      proposalsSent: 2,
      proposalsValue: "15500.00",
      jobsSold: 1,
      soldValue: "12000.00",
      averageSale: "12000.00",
      closeRate: "0.5000", // won 1, lost 1 on price; the spam lead doesn't count
    });
  });

  it("lost reasons, with the value that was quoted", () => {
    const price = (v: Views) => v.oct.lostReasons.find((r) => r.reason === "Price");
    expect(countUp((v) => price(v)?.count)).toBe(1);
    expect(moneyUp((v) => price(v)?.quotedValue)).toBe("6000.00");
  });

  it("the monthly chart puts jobs and leads in their Vancouver month", () => {
    const up = (key: string) => ({
      leads: countUp((v) => month(v.oct, key).leads),
      sold: countUp((v) => month(v.oct, key).sold),
      sales: moneyUp((v) => month(v.oct, key).sales),
      completed: countUp((v) => month(v.oct, key).completed),
      produced: moneyUp((v) => month(v.oct, key).produced),
    });
    expect(up("2026-08")).toEqual({ leads: 0, sold: 1, sales: "1500.00", completed: 0, produced: "0.00" });
    expect(up("2026-09")).toEqual({ leads: 2, sold: 3, sales: "12000.00", completed: 1, produced: "1500.00" });
    expect(up("2026-10")).toEqual({ leads: 3, sold: 2, sales: "15000.00", completed: 1, produced: "2000.00" });
  });
});

describe("Vancouver month boundaries", () => {
  it("23:30 on the last day of a month belongs to that month", () => {
    // October starts at 00:00 Oct 1: the 00:30 Oct 1 sale is in this month's sales above, the 23:30 Sep 30 one isn't.
    // September: sold Sep 10, Sep 25 and 23:30 Sep 30, not 23:30 Aug 31.
    expect(moneyUp((v) => v.sep.money!.sales.value)).toBe("12000.00");
    expect(countUp((v) => v.sep.counts.jobsSold.value)).toBe(3);
    expect(moneyUp((v) => v.sep.money!.sales.compare)).toBe("1500.00"); // August: 23:30 Aug 31
    expect(countUp((v) => v.sep.counts.jobsSold.compare)).toBe(1);
    expect(moneyUp((v) => v.sep.money!.produced.value)).toBe("1500.00"); // finished 23:45 Sep 30
    expect(countUp((v) => v.sep.counts.leads.value)).toBe(2); // Sep 10 and 23:30 Sep 30
  });

  it("after BC stops changing its clocks (Nov 1, 2026), a month still ends at 07:00 UTC", () => {
    const november = periodOf("last_month", NOW_DEC).current;
    expect([november.start.toISOString(), november.end.toISOString()]).toEqual(["2026-11-01T07:00:00.000Z", "2026-12-01T07:00:00.000Z"]);
    expect(moneyUp((v) => v.nov.money!.sales.value)).toBe("700.00"); // 23:30 Nov 30 = 06:30 UTC Dec 1
    expect(countUp((v) => v.nov.counts.jobsSold.value)).toBe(1);
    expect(moneyUp((v) => v.dec.money!.sales.value)).toBe("800.00"); // 00:30 Dec 1 = 07:30 UTC
    expect(countUp((v) => v.dec.counts.jobsSold.value)).toBe(1);
    expect(countUp((v) => month(v.dec, "2026-11").sold)).toBe(1);
    expect(moneyUp((v) => month(v.dec, "2026-11").sales)).toBe("700.00");
    expect(countUp((v) => month(v.dec, "2026-12").sold)).toBe(1);
    expect(moneyUp((v) => month(v.dec, "2026-12").sales)).toBe("800.00");
  });
});

describe("what each role sees", () => {
  it("an estimator gets the same counts and pipeline, and no company money", async () => {
    const access = accessFor("estimator");
    const home = await getMonthSnapshot(NOW, access);
    const goals = await getGoals();
    const oct = await getPerformance(periodOf("this_month", NOW, goals.fiscalYearStartMonth), access, { goals, now: NOW });

    expect("money" in home).toBe(false);
    expect(home.counts).toEqual(after.home.counts);
    expect(home.pipeline).toEqual(after.home.pipeline); // open quote values: estimates.read

    expect("money" in oct).toBe(false);
    expect(oct.monthly.money).toBeUndefined();
    expect(oct.counts).toEqual(after.oct.counts);
    expect(oct.people.find((p) => p.userId === seller.id)).toEqual({ userId: seller.id, name: seller.name, visitsCompleted: 1, proposalsSent: 2, jobsSold: 1, closeRate: "0.5000" });
  });
});

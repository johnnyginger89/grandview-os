import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activities,
  contacts,
  customers,
  estimates,
  messageTemplates,
  opportunities,
  outboundMessages,
  pipelineStages,
  properties,
  proposals,
  user,
  type LEAD_CHANNELS,
} from "@/db/schema";
import { can } from "@/lib/authz/permissions";
import { sendEmail } from "@/lib/email";
import { LEAD_TEXT_MAX, leadEmail, PROJECT_TYPE_MAX, PROJECT_TYPES_MAX } from "@/lib/pipeline/lead-input";
import { BOOKING_CANCELLED_REASON, cancellationLosesLead, lostToCancellation, normalizePhone, planContactMerge, planLeadMerge } from "@/lib/pipeline/lead-merge";
import { stageTransitionPatch } from "@/lib/pipeline/stage-transition";
import { parseBusinessDateTime } from "@/lib/time";
import { formatAddress, formatDate, formatDateTime, fullName, renderTemplate } from "@/lib/utils";
import { audit } from "./audit";
import { milestoneUpdates } from "./lead-milestones";
import { getCompany } from "./settings";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Opportunity = typeof opportunities.$inferSelect;
type Stage = typeof pipelineStages.$inferSelect;
type Customer = typeof customers.$inferSelect;

const optStr = z
  .string()
  .trim()
  .max(LEAD_TEXT_MAX)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Normalized lead coming from any channel. */
export const leadInputSchema = z.object({
  firstName: optStr,
  lastName: optStr,
  company: optStr,
  email: leadEmail
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  phone: optStr,
  street: optStr,
  unit: optStr,
  city: optStr,
  postalCode: optStr,
  propertyType: optStr,
  projectTypes: z.array(z.string().trim().max(PROJECT_TYPE_MAX)).max(PROJECT_TYPES_MAX).default([]),
  description: optStr,
  timeline: optStr,
  leadSource: optStr,
  channel: z.string().optional().nullable(),
  visitAt: z
    .union([z.string(), z.date()])
    .optional()
    .nullable()
    .transform((v) => parseBusinessDateTime(v ?? null)),
  bookingRef: optStr,
  bookingManageUrl: optStr,
  estimatorId: optStr,
  notes: optStr,
});
export type LeadInput = z.input<typeof leadInputSchema>;
type Lead = z.output<typeof leadInputSchema>;

export async function stageByKey(key: string, tx: Tx | typeof db = db) {
  const s = await tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.key, key) });
  if (!s) throw new Error(`Pipeline stage "${key}" is missing. Run the seed.`);
  return s;
}

/** Find an existing customer by email or phone so repeat inquiries don't create duplicates. */
async function findCustomer(tx: Tx, email: string | null, phone: string | null) {
  if (email) {
    const c = await tx.query.customers.findFirst({ where: and(eq(sql`lower(${customers.email})`, email), isNull(customers.archivedAt)) });
    if (c) return c;
    const ct = await tx.query.contacts.findFirst({ where: eq(sql`lower(${contacts.email})`, email) });
    if (ct?.customerId) return tx.query.customers.findFirst({ where: eq(customers.id, ct.customerId) });
  }
  const digits = normalizePhone(phone);
  if (digits && digits.length >= 10) {
    const c = await tx.query.customers.findFirst({
      where: and(eq(sql`regexp_replace(${customers.phone}, '\\D', '', 'g')`, digits), isNull(customers.archivedAt)),
    });
    if (c) return c;
  }
  return undefined;
}

function opportunityTitle(name: string, projectTypes: string[], city: string | null) {
  return [name, projectTypes.join(", "), city].filter(Boolean).join(" – ");
}

export type IngestOutcome = "created" | "merged" | "promoted" | "reopened" | "booking_updated";

export interface IngestResult {
  opportunityId: string;
  customerId: string;
  created: boolean;
  matchedExistingCustomer: boolean;
  /**
   * created: a new lead · merged: added to the customer's open lead · promoted: a booking
   * moved an early lead to Estimate Booked · reopened: booked again after a cancellation ·
   * booking_updated: the same booking changed.
   */
  outcome: IngestOutcome;
  customerName: string;
  estimatorId: string | null;
  stageName: string;
  visitAt: Date | null;
}

/**
 * Create or update a lead. Used by the manual "New lead" form, website form
 * submissions and YouCanBook.me bookings.
 *
 * - Customers are matched by email, then phone. A matched customer's new email or
 *   phone fills an empty field; a different one is noted on the lead's timeline.
 * - A booking for someone who already has an open lead moves that lead to
 *   "Estimate Booked" instead of creating a duplicate; a lead lost only because its
 *   booking was cancelled is reopened.
 * - With `matchOpenLead` (website forms), a repeat inquiry is added to the
 *   customer's open lead.
 * - New details for an existing lead fill its empty fields and are added to its
 *   description and timeline. Nothing on file is overwritten.
 */
export async function ingestLead(
  raw: LeadInput,
  opts: {
    stageKey: string;
    channel: (typeof LEAD_CHANNELS)[number];
    externalSource?: string;
    externalRef?: string | null;
    actorId?: string | null;
    matchOpenLead?: boolean;
  },
): Promise<IngestResult> {
  const input = leadInputSchema.parse(raw);
  const name = fullName(input.firstName, input.lastName) || input.company || input.email || input.phone || "Unnamed lead";
  const actorId = opts.actorId ?? null;

  return db.transaction(async (tx) => {
    const now = new Date();
    const stage = await stageByKey(opts.stageKey, tx);
    const sameBooking =
      opts.externalSource && opts.externalRef
        ? await tx.query.opportunities.findFirst({
            where: and(eq(opportunities.externalSource, opts.externalSource), eq(opportunities.externalRef, opts.externalRef)),
          })
        : undefined;

    let customer = sameBooking
      ? await tx.query.customers.findFirst({ where: eq(customers.id, sameBooking.customerId) })
      : await findCustomer(tx, input.email ?? null, input.phone);
    const matchedExistingCustomer = !!customer;
    const contactNotes = customer ? await mergeContactDetails(tx, customer, input, now, actorId) : [];
    if (!customer) {
      [customer] = await tx
        .insert(customers)
        .values({
          type: input.propertyType === "Commercial" ? "commercial" : input.propertyType === "Strata Complex" ? "strata" : "residential",
          displayName: input.company && !input.firstName ? input.company : name,
          email: input.email ?? null,
          phone: input.phone,
          source: input.leadSource,
          createdBy: actorId,
        })
        .returning();
      await tx.insert(contacts).values({
        customerId: customer.id,
        firstName: input.firstName ?? "",
        lastName: input.lastName ?? "",
        email: input.email ?? null,
        phone: input.phone,
        isPrimary: true,
      });
    }
    const found = customer;
    const property = await findOrAddProperty(tx, found.id, input);
    const merging: MergeContext = { tx, input, property, now, actorId, channel: opts.channel, contactNotes };
    const result = (opp: { id: string; estimatorId: string | null }, outcome: IngestOutcome, stageName: string, visitAt: Date | null): IngestResult => ({
      opportunityId: opp.id,
      customerId: found.id,
      created: outcome === "created",
      matchedExistingCustomer,
      outcome,
      customerName: found.displayName,
      estimatorId: opp.estimatorId,
      stageName,
      visitAt,
    });

    // Same external booking seen before → update in place; booking it again after a cancellation reopens the lead.
    if (sameBooking) {
      const current = await tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, sameBooking.stageId) });
      const reopen = !!current && lostToCancellation(sameBooking, current) && stage.kind === "open";
      const visitAt = input.visitAt ?? sameBooking.estimateVisitAt;
      await mergeIntoLead(
        merging,
        sameBooking,
        {
          estimateVisitAt: visitAt,
          bookingManageUrl: input.bookingManageUrl ?? sameBooking.bookingManageUrl,
          ...(reopen ? { ...stageTransitionPatch(sameBooking, stage, now), nextFollowUpAt: null } : {}),
          ...milestoneUpdates(sameBooking, { newVisitAt: input.visitAt, toStageKey: reopen ? stage.key : undefined }, now),
        },
        {
          type: "booking",
          body: reopen ? `Booked again – reopened and moved back to ${stage.name}` : input.visitAt ? `Booking updated – visit ${formatDateTime(input.visitAt)}` : "Booking updated",
          meta: { source: opts.externalSource },
        },
      );
      if (reopen && current) await audit({ actorId, action: "lead.stage", entityType: "opportunity", entityId: sameBooking.id, before: { stage: current.key }, after: { stage: stage.key } }, tx);
      return result(sameBooking, reopen ? "reopened" : "booking_updated", reopen ? stage.name : (current?.name ?? stage.name), visitAt);
    }

    // A booking from someone with an open, un-booked lead promotes that lead; a lead lost only
    // because its last booking was cancelled is reopened rather than duplicated.
    if (matchedExistingCustomer && opts.stageKey === "estimate_booked") {
      const [early] = await tx
        .select({ opp: opportunities, stageKey: pipelineStages.key, stageKind: pipelineStages.kind })
        .from(opportunities)
        .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
        .where(
          and(
            eq(opportunities.customerId, found.id),
            or(inArray(pipelineStages.key, ["new_lead", "contacted", "follow_up"]), and(eq(pipelineStages.kind, "lost"), eq(opportunities.lostReason, BOOKING_CANCELLED_REASON))),
          ),
        )
        .orderBy(sql`${pipelineStages.kind} = 'lost'`, desc(opportunities.createdAt))
        .limit(1);
      if (early) {
        const reopen = early.stageKind === "lost";
        await mergeIntoLead(
          merging,
          early.opp,
          {
            ...stageTransitionPatch(early.opp, stage, now),
            estimateVisitAt: input.visitAt ?? null,
            bookingRef: input.bookingRef,
            bookingManageUrl: input.bookingManageUrl,
            externalSource: opts.externalSource ?? null,
            externalRef: opts.externalRef ?? null,
            nextFollowUpAt: null,
            ...milestoneUpdates(early.opp, { newVisitAt: input.visitAt, toStageKey: stage.key }, now),
          },
          {
            type: "booking",
            body: reopen ? `Booked again – reopened and moved back to ${stage.name}` : `Estimate visit booked – moved to ${stage.name}`,
            meta: { source: opts.externalSource, visitAt: input.visitAt },
          },
        );
        await audit({ actorId, action: "lead.stage", entityType: "opportunity", entityId: early.opp.id, before: { stage: early.stageKey }, after: { stage: stage.key } }, tx);
        return result(early.opp, reopen ? "reopened" : "promoted", stage.name, input.visitAt);
      }
    }

    // Someone who already has an open lead and asks again: add it to that lead.
    if (matchedExistingCustomer && opts.matchOpenLead) {
      const [open] = await tx
        .select({ opp: opportunities, stageName: pipelineStages.name })
        .from(opportunities)
        .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
        .where(and(eq(opportunities.customerId, found.id), eq(pipelineStages.kind, "open")))
        .orderBy(desc(opportunities.updatedAt))
        .limit(1);
      if (open) {
        await mergeIntoLead(merging, open.opp, {}, { type: "system", body: `New inquiry from ${sourcePhrase(opts.channel)} – added to this lead`, meta: { source: opts.externalSource ?? opts.channel } });
        return result(open.opp, "merged", open.stageName, open.opp.estimateVisitAt);
      }
    }

    const [opp] = await tx
      .insert(opportunities)
      .values({
        title: opportunityTitle(name, input.projectTypes, input.city),
        customerId: found.id,
        propertyId: property?.id ?? null,
        stageId: stage.id,
        source: input.leadSource,
        channel: opts.channel,
        projectTypes: input.projectTypes,
        description: input.description,
        timeline: input.timeline,
        estimatorId: input.estimatorId,
        estimateVisitAt: input.visitAt ?? null,
        visitBookedAt: input.visitAt ? now : null,
        bookingRef: input.bookingRef,
        bookingManageUrl: input.bookingManageUrl,
        externalSource: opts.externalSource ?? null,
        externalRef: opts.externalRef ?? null,
        createdBy: actorId,
      })
      .returning();

    await addTimeline(
      tx,
      { customerId: found.id, opportunityId: opp.id, createdBy: actorId },
      {
        type: opts.stageKey === "estimate_booked" ? "booking" : "system",
        body: opts.stageKey === "estimate_booked" ? `Estimate visit booked via ${channelLabel(opts.externalSource ?? opts.channel)}` : `New lead from ${channelLabel(opts.channel)}`,
        meta: { source: opts.externalSource ?? opts.channel },
      },
      [input.notes, ...contactNotes],
      now,
    );
    await audit({ actorId, action: "lead.create", entityType: "opportunity", entityId: opp.id, after: { channel: opts.channel } }, tx);
    return result(opp, "created", stage.name, opp.estimateVisitAt);
  });
}

/** "the website form", "YouCanBook.me" or "manual entry", for timeline text. */
function sourcePhrase(channel: string) {
  return channel === "website_form" ? "the website form" : channel === "youcanbookme" ? "YouCanBook.me" : "manual entry";
}

interface TimelineEvent {
  type: (typeof activities.$inferInsert)["type"];
  body: string;
  meta?: Record<string, unknown>;
}

/** An event on the lead's timeline and, just below it, a note with any details. */
async function addTimeline(tx: Tx, base: { customerId: string; opportunityId: string; createdBy: string | null }, event: TimelineEvent, note: (string | null)[], now: Date) {
  // Both are written in the same instant, so the event is stamped a millisecond later to sit on top.
  const rows: (typeof activities.$inferInsert)[] = [{ ...base, ...event, createdAt: new Date(now.getTime() + 1) }];
  const body = note.filter((l) => l !== null).join("\n").trim();
  if (body) rows.push({ ...base, type: "note", body, createdAt: now });
  await tx.insert(activities).values(rows);
}

/** A matched customer's new email or phone fills an empty field. Returns what to note on the lead. */
async function mergeContactDetails(tx: Tx, customer: Customer, input: Lead, now: Date, actorId: string | null): Promise<string[]> {
  if (!input.email && !input.phone) return [];
  const people = await tx
    .select({ id: contacts.id, email: contacts.email, phone: contacts.phone, phone2: contacts.phone2, isPrimary: contacts.isPrimary })
    .from(contacts)
    .where(eq(contacts.customerId, customer.id));
  const primary = people.find((p) => p.isPrimary) ?? null;
  const plan = planContactMerge(
    { customer, primary, emails: [customer.email, ...people.map((p) => p.email)], phones: [customer.phone, ...people.flatMap((p) => [p.phone, p.phone2])] },
    { email: input.email ?? null, phone: input.phone },
  );
  const filled = Object.keys(plan.customer) as ("email" | "phone")[];
  if (filled.length) {
    await tx.update(customers).set({ ...plan.customer, updatedAt: now }).where(eq(customers.id, customer.id));
    await audit({ actorId, action: "customer.update", entityType: "customer", entityId: customer.id, before: Object.fromEntries(filled.map((k) => [k, customer[k]])), after: plan.customer }, tx);
  }
  if (primary && Object.keys(plan.primary).length) await tx.update(contacts).set({ ...plan.primary, updatedAt: now }).where(eq(contacts.id, primary.id));
  return plan.mentions;
}

async function findOrAddProperty(tx: Tx, customerId: string, input: Lead): Promise<{ id: string; address: string } | null> {
  if (!input.street) return null;
  const existing = await tx.query.properties.findFirst({ where: and(eq(properties.customerId, customerId), ilike(properties.street, input.street)) });
  const [p] = existing
    ? [existing]
    : await tx
        .insert(properties)
        .values({ customerId, street: input.street, unit: input.unit, city: input.city, postalCode: input.postalCode, propertyType: mapPropertyType(input.propertyType) })
        .returning();
  return { id: p.id, address: formatAddress(p) };
}

interface MergeContext {
  tx: Tx;
  input: Lead;
  property: { id: string; address: string } | null;
  now: Date;
  actorId: string | null;
  channel: string;
  contactNotes: string[];
}

/**
 * New details for a lead that already exists, written with any booking or stage fields in
 * `extra`: empty fields are filled, a new message is added to the description, and the
 * event goes on the timeline with a note of everything new or different.
 */
async function mergeIntoLead(ctx: MergeContext, opp: Opportunity, extra: Partial<typeof opportunities.$inferInsert>, event: TimelineEvent) {
  const { tx, input, now } = ctx;
  const via = sourcePhrase(ctx.channel);
  const merge = planLeadMerge(
    { source: opp.source, projectTypes: opp.projectTypes, timeline: opp.timeline, description: opp.description, propertyId: opp.propertyId },
    { source: input.leadSource, projectTypes: input.projectTypes, timeline: input.timeline, description: input.description, propertyId: ctx.property?.id ?? null, address: ctx.property?.address ?? null },
    `From ${via}, ${formatDate(now)}`,
  );
  await tx.update(opportunities).set({ ...merge.patch, ...extra, updatedAt: now }).where(eq(opportunities.id, opp.id));
  const others = [input.notes, ...merge.mentions, ...ctx.contactNotes].filter((l): l is string => !!l);
  const note = merge.message || others.length ? [`New details from ${via}:`, merge.message, ...(merge.message && others.length ? [""] : []), ...others] : [];
  await addTimeline(tx, { customerId: opp.customerId, opportunityId: opp.id, createdBy: ctx.actorId }, event, note, now);
  if (Object.keys(merge.patch).length) {
    await audit({ actorId: ctx.actorId, action: "lead.merge", entityType: "opportunity", entityId: opp.id, after: { channel: ctx.channel, filled: Object.keys(merge.patch) } }, tx);
  }
}

export type CancelOutcome = "lost" | "noted" | "not_found";

export interface CancelResult {
  outcome: CancelOutcome;
  opportunityId: string | null;
  customerName: string | null;
  estimatorId: string | null;
  stageName: string | null;
}

/**
 * A booking cancelled in YouCanBook.me. While the lead is still waiting for its estimate
 * visit it moves to Lost; further along (estimate done, proposal out, won…) it stays where
 * it is and the cancellation is noted on its timeline.
 */
export async function cancelBooking(ref: string, externalSource = "youcanbookme"): Promise<CancelResult> {
  return db.transaction(async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.externalSource, externalSource), eq(opportunities.externalRef, ref)))
      .for("update");
    if (!opp) return { outcome: "not_found", opportunityId: null, customerName: null, estimatorId: null, stageName: null };
    const from = await tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, opp.stageId) });
    const customer = await tx.query.customers.findFirst({ where: eq(customers.id, opp.customerId) });
    const base = { opportunityId: opp.id, customerName: customer?.displayName ?? null, estimatorId: opp.estimatorId };
    if (from && cancellationLosesLead(from)) {
      const lost = await stageByKey("lost", tx);
      await moveStageInTx(tx, opp.id, lost.id, null, BOOKING_CANCELLED_REASON, { opp, from, to: lost });
      return { ...base, outcome: "lost", stageName: lost.name };
    }
    await tx.insert(activities).values({
      customerId: opp.customerId,
      opportunityId: opp.id,
      type: "booking",
      body: `Booking cancelled in YouCanBook.me. The lead stays in ${from?.name ?? "its stage"}.`,
      meta: { source: externalSource, cancelled: true },
    });
    return { ...base, outcome: "noted", stageName: from?.name ?? null };
  });
}

function mapPropertyType(v: string | null) {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.includes("strata")) return "strata_complex" as const;
  if (s.includes("town")) return "townhouse" as const;
  if (s.includes("condo") || s.includes("apartment")) return "condo" as const;
  if (s.includes("commercial")) return "commercial" as const;
  if (s.includes("detached") || s.includes("house")) return "detached" as const;
  return "other" as const;
}

export function channelLabel(c: string | null | undefined) {
  const labels: Record<string, string> = {
    youcanbookme: "YouCanBook.me",
    website_form: "website form",
    phone: "phone",
    email: "email",
    facebook: "Facebook",
    instagram: "Instagram",
    referral: "referral",
    other: "other",
  };
  return labels[c ?? ""] ?? "manual entry";
}

/** Called when a team member opens a lead. Records first view once. */
export async function markViewed(opportunityId: string, userId: string) {
  const res = await db
    .update(opportunities)
    .set({ firstViewedAt: new Date() })
    .where(and(eq(opportunities.id, opportunityId), isNull(opportunities.firstViewedAt)))
    .returning({ id: opportunities.id, customerId: opportunities.customerId });
  if (res[0]) {
    await db.insert(activities).values({ customerId: res[0].customerId, opportunityId, type: "system", body: "Lead opened for the first time", createdBy: userId });
  }
}

/**
 * Move one lead inside an existing transaction. Returns "unchanged" when the lead is
 * already in that stage. Bulk moves pass rows they have already loaded and locked.
 */
export async function moveStageInTx(
  tx: Tx,
  opportunityId: string,
  stageId: string,
  userId: string | null,
  lostReason?: string | null,
  preload?: { opp?: Opportunity; from?: Stage; to?: Stage },
): Promise<"moved" | "unchanged"> {
  // Lock the row so a concurrent move can't interleave between the read and the write.
  const opp = preload?.opp ?? (await tx.select().from(opportunities).where(eq(opportunities.id, opportunityId)).for("update"))[0];
  if (!opp) throw new Error("Lead not found");
  const to = preload?.to ?? (await tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, stageId) }));
  if (!to) throw new Error("Stage not found");
  if (opp.stageId === to.id) return "unchanged";
  const from = preload?.from ?? (await tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, opp.stageId) }));
  const now = new Date();
  await tx
    .update(opportunities)
    .set({ ...stageTransitionPatch(opp, to, now, lostReason), ...milestoneUpdates(opp, { toStageKey: to.key }, now) })
    .where(eq(opportunities.id, opp.id));
  await tx.insert(activities).values({
    customerId: opp.customerId,
    opportunityId: opp.id,
    type: "stage_change",
    body: `Moved from ${from?.name ?? "?"} to ${to.name}${to.kind === "lost" && lostReason ? ` (${lostReason})` : ""}`,
    createdBy: userId,
  });
  await audit({ actorId: userId, action: "lead.stage", entityType: "opportunity", entityId: opp.id, before: { stage: from?.key }, after: { stage: to.key } }, tx);
  if (to.kind === "lost") await closeProposalsOfLostLead(tx, opp, userId);
  return "moved";
}

/**
 * A lost lead's quotes stop accepting signatures, so a customer can't sign for a job the office
 * has given up on. The estimates are locked first, as every change to their proposals does.
 */
async function closeProposalsOfLostLead(tx: Tx, opp: Opportunity, userId: string | null) {
  const quotes = await tx.select({ id: estimates.id, number: estimates.number }).from(estimates).where(eq(estimates.opportunityId, opp.id)).orderBy(asc(estimates.id)).for("update");
  if (!quotes.length) return;
  const closed = await tx
    .update(proposals)
    .set({ status: "withdrawn" })
    .where(and(inArray(proposals.estimateId, quotes.map((q) => q.id)), inArray(proposals.status, ["sent", "viewed"])))
    .returning({ id: proposals.id, estimateId: proposals.estimateId });
  for (const p of closed) {
    const number = quotes.find((q) => q.id === p.estimateId)?.number;
    await tx.insert(activities).values({ customerId: opp.customerId, opportunityId: opp.id, type: "estimate", body: `Proposal for estimate #${number} withdrawn: the lead was marked Lost`, createdBy: userId });
    await audit({ actorId: userId, action: "proposal.withdraw", entityType: "proposal", entityId: p.id, after: { estimateId: p.estimateId, reason: "lead_lost" } }, tx);
  }
}

export async function moveStage(opportunityId: string, stageId: string, userId: string | null, lostReason?: string | null): Promise<void> {
  await db.transaction((tx) => moveStageInTx(tx, opportunityId, stageId, userId, lostReason));
}

/** Stages a visit booking moves on to "Estimate booked", the same as a YouCanBook.me booking. */
const BEFORE_VISIT = ["new_lead", "contacted", "follow_up"];

/**
 * The office books (or moves) the estimate visit, by phone or in person. It counts like a
 * YouCanBook.me booking: the first booking is the visit-booked milestone, and a lead still
 * waiting for a visit moves to "Estimate booked".
 */
export async function bookVisit(opportunityId: string, at: Date, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [opp] = await tx.select().from(opportunities).where(eq(opportunities.id, opportunityId)).for("update");
    if (!opp) throw new Error("Lead not found");
    const from = await tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, opp.stageId) });
    if (from?.kind !== "open") throw new Error("This lead is closed. Move it back to an open stage first.");
    const now = new Date();
    const patch = { estimateVisitAt: at, ...milestoneUpdates(opp, { newVisitAt: at }, now), updatedAt: now };
    await tx.update(opportunities).set(patch).where(eq(opportunities.id, opp.id));
    const when = formatDateTime(at);
    await tx.insert(activities).values({ customerId: opp.customerId, opportunityId: opp.id, type: "booking", body: opp.estimateVisitAt ? `Estimate visit moved to ${when}` : `Estimate visit booked for ${when}`, createdBy: userId });
    await audit({ actorId: userId, action: "lead.visit", entityType: "opportunity", entityId: opp.id, before: { estimateVisitAt: opp.estimateVisitAt?.toISOString() ?? null }, after: { estimateVisitAt: at.toISOString() } }, tx);
    if (BEFORE_VISIT.includes(from.key)) {
      const booked = await stageByKey("estimate_booked", tx);
      await moveStageInTx(tx, opp.id, booked.id, userId, null, { opp: { ...opp, ...patch }, from, to: booked });
    }
  });
}

/** Stages a lead passes through before the customer has a proposal. */
const BEFORE_PROPOSAL = ["new_lead", "contacted", "estimate_booked", "estimate_completed"];

/** A proposal went out for this lead: a lead still before "Proposal sent" moves there, never backwards. */
export async function advanceToProposalSent(opportunityId: string, userId: string | null): Promise<void> {
  const [opp] = await db
    .select({ key: pipelineStages.key })
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(eq(opportunities.id, opportunityId));
  if (opp && BEFORE_PROPOSAL.includes(opp.key)) await moveStage(opportunityId, (await stageByKey("proposal_sent")).id, userId);
}

/** Lock leads in id order so two bulk edits can't deadlock each other. */
function lockOpportunities(tx: Tx, ids: string[]) {
  return tx.select().from(opportunities).where(inArray(opportunities.id, ids)).orderBy(asc(opportunities.id)).for("update");
}

/** Move many leads at once. Each lead gets its own timeline entry and audit row, plus one summary audit row. */
export async function bulkMoveStage(ids: string[], stageId: string, actorId: string, lostReason: string | null): Promise<{ moved: number; unchanged: number; missing: number }> {
  return db.transaction(async (tx) => {
    const stages = await tx.select().from(pipelineStages);
    const byId = new Map(stages.map((s) => [s.id, s]));
    const to = byId.get(stageId);
    if (!to) throw new Error("Stage not found");
    if (to.kind === "lost" && !lostReason) throw new Error("Choose why these leads were lost.");
    const opps = await lockOpportunities(tx, ids);
    const moved: string[] = [];
    for (const opp of opps) {
      const r = await moveStageInTx(tx, opp.id, to.id, actorId, lostReason, { opp, from: byId.get(opp.stageId), to });
      if (r === "moved") moved.push(opp.id);
    }
    if (moved.length) {
      await audit({ actorId, action: "lead.bulk_stage", entityType: "opportunity", entityId: null, after: { stage: to.key, ids: moved } }, tx);
    }
    return { moved: moved.length, unchanged: opps.length - moved.length, missing: ids.length - opps.length };
  });
}

/** Set or clear the next follow-up on one or more leads. */
export async function setNextFollowUp(ids: string[], at: Date | null, actorId: string): Promise<{ updated: number }> {
  return db.transaction(async (tx) => {
    const before = await lockOpportunities(tx, ids);
    if (!before.length) return { updated: 0 };
    const now = new Date();
    await tx
      .update(opportunities)
      .set({ nextFollowUpAt: at, updatedAt: now })
      .where(inArray(opportunities.id, before.map((o) => o.id)));
    // A "system" entry, so setting a follow-up doesn't count as contacting the customer.
    const body = at ? `Follow-up set for ${formatDate(at, { weekday: "short", month: "short", day: "numeric" })}` : "Follow-up cleared";
    await tx.insert(activities).values(before.map((o) => ({ customerId: o.customerId, opportunityId: o.id, type: "system" as const, body, createdBy: actorId })));
    for (const o of before) {
      await audit({ actorId, action: "lead.follow_up", entityType: "opportunity", entityId: o.id, before: { nextFollowUpAt: o.nextFollowUpAt?.toISOString() ?? null }, after: { nextFollowUpAt: at?.toISOString() ?? null } }, tx);
    }
    return { updated: before.length };
  });
}

/** Assign (or remove) the estimator on one or more leads. Only active people who can write estimates qualify. */
export async function assignEstimator(ids: string[], estimatorId: string | null, actorId: string): Promise<{ updated: number }> {
  return db.transaction(async (tx) => {
    let name: string | null = null;
    if (estimatorId) {
      const person = await tx.query.user.findFirst({ where: eq(user.id, estimatorId) });
      if (!person || !person.active || !can(person.role, "estimates.write")) throw new Error("That person can't be assigned as estimator.");
      name = person.name;
    }
    const before = await lockOpportunities(tx, ids);
    if (!before.length) return { updated: 0 };
    await tx
      .update(opportunities)
      .set({ estimatorId, updatedAt: new Date() })
      .where(inArray(opportunities.id, before.map((o) => o.id)));
    const body = name ? `Estimator set to ${name}` : "Estimator removed";
    await tx.insert(activities).values(before.map((o) => ({ customerId: o.customerId, opportunityId: o.id, type: "system" as const, body, createdBy: actorId })));
    for (const o of before) {
      await audit({ actorId, action: "lead.estimator", entityType: "opportunity", entityId: o.id, before: { estimatorId: o.estimatorId }, after: { estimatorId } }, tx);
    }
    return { updated: before.length };
  });
}

/** Resolve the booking-link email for a lead (used for preview and for sending). */
export async function composeBookingEmail(opportunityId: string, senderName: string, templateKey = "lead_booking_link") {
  const opp = await db.query.opportunities.findFirst({ where: eq(opportunities.id, opportunityId) });
  if (!opp) throw new Error("Lead not found");
  const [customer, contact, template, company] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, opp.customerId) }),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, opp.customerId), eq(contacts.isPrimary, true)) }),
    db.query.messageTemplates.findFirst({ where: eq(messageTemplates.key, templateKey) }),
    getCompany(),
  ]);
  if (!template) throw new Error("Booking email template is missing");
  const to = contact?.email ?? customer?.email;
  const vars = {
    first_name: contact?.firstName || customer?.displayName?.split(" ")[0] || "there",
    project_types: opp.projectTypes.length ? opp.projectTypes.join(" / ").toLowerCase() : "painting",
    booking_url: company.bookingUrl,
    company_phone: company.phone,
    sender_name: senderName,
  };
  return {
    opp,
    to: to ?? null,
    subject: renderTemplate(template.subject ?? "", vars),
    body: renderTemplate(template.body, vars),
    bookingUrlConfigured: !!company.bookingUrl,
    templateKey,
  };
}

/**
 * One click: send the YouCanBook.me link to a lead. Human-initiated only.
 * Moves "New Lead" to "Contacted" and logs the message on the timeline.
 */
export async function sendBookingLink(opportunityId: string, user: { id: string; name: string }, templateKey?: string) {
  const msg = await composeBookingEmail(opportunityId, user.name, templateKey);
  if (!msg.to) throw new Error("This lead has no email address.");
  if (!msg.bookingUrlConfigured) throw new Error("Add your YouCanBook.me link in Settings first.");

  const result = await sendEmail({ to: msg.to, subject: msg.subject, text: msg.body, replyTo: process.env.EMAIL_REPLY_TO });
  const now = new Date();
  await db.insert(outboundMessages).values({
    channel: "email",
    toAddress: msg.to,
    subject: msg.subject,
    body: msg.body,
    status: result.status,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    error: result.error,
    customerId: msg.opp.customerId,
    opportunityId,
    templateKey: msg.templateKey,
    sentBy: user.id,
    sentAt: result.status === "failed" ? null : now,
  });
  if (result.status === "failed") throw new Error(`Email failed: ${result.error}`);

  await db.insert(activities).values({
    customerId: msg.opp.customerId,
    opportunityId,
    type: "email",
    body: `Booking link sent to ${msg.to}${result.status === "logged" ? " (development – not actually delivered)" : ""}`,
    meta: { subject: msg.subject },
    createdBy: user.id,
  });
  await db
    .update(opportunities)
    .set({ lastContactedAt: now, nextFollowUpAt: new Date(now.getTime() + 3 * 86_400_000), updatedAt: now })
    .where(eq(opportunities.id, opportunityId));

  const stage = await db.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, msg.opp.stageId) });
  if (stage?.key === "new_lead") {
    const contacted = await stageByKey("contacted");
    await moveStage(opportunityId, contacted.id, user.id);
  }
  return result;
}

export async function addNote(opportunityId: string, body: string, userId: string, type: "note" | "call" = "note") {
  const opp = await db.query.opportunities.findFirst({ where: eq(opportunities.id, opportunityId) });
  if (!opp) throw new Error("Lead not found");
  await db.insert(activities).values({ customerId: opp.customerId, opportunityId, type, body, createdBy: userId });
  if (type === "call") {
    await db.update(opportunities).set({ lastContactedAt: new Date() }).where(eq(opportunities.id, opportunityId));
  }
}

export async function searchCustomersByText(q: string) {
  const term = `%${q}%`;
  return db.query.customers.findMany({
    where: and(isNull(customers.archivedAt), or(ilike(customers.displayName, term), ilike(customers.email, term), ilike(customers.phone, term))),
    limit: 10,
  });
}

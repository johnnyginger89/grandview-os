import "server-only";
import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activities,
  contacts,
  customers,
  inboundEvents,
  messageTemplates,
  opportunities,
  outboundMessages,
  pipelineStages,
  properties,
  type LEAD_CHANNELS,
} from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { fullName, renderTemplate } from "@/lib/utils";
import { audit } from "./audit";
import { getCompany } from "./settings";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const optStr = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Normalized lead coming from any channel. */
export const leadInputSchema = z.object({
  firstName: optStr,
  lastName: optStr,
  company: optStr,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  phone: optStr,
  street: optStr,
  unit: optStr,
  city: optStr,
  postalCode: optStr,
  propertyType: optStr,
  projectTypes: z.array(z.string().trim().max(100)).max(20).default([]),
  description: optStr,
  timeline: optStr,
  leadSource: optStr,
  channel: z.string().optional().nullable(),
  visitAt: z.coerce.date().optional().nullable(),
  bookingRef: optStr,
  bookingManageUrl: optStr,
  estimatorId: optStr,
  notes: optStr,
});
export type LeadInput = z.input<typeof leadInputSchema>;

export async function stageByKey(key: string, tx: Tx | typeof db = db) {
  const s = await tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.key, key) });
  if (!s) throw new Error(`Pipeline stage "${key}" is missing. Run the seed.`);
  return s;
}

function normalizePhone(p: string | null) {
  return p ? p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : null;
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

export interface IngestResult {
  opportunityId: string;
  customerId: string;
  created: boolean;
  matchedExistingCustomer: boolean;
}

/**
 * Create or update a lead. Used by the manual "New lead" form, website form
 * submissions and YouCanBook.me bookings.
 *
 * - Customers are matched by email, then phone.
 * - A booking for someone who already has an open lead moves that lead to
 *   "Estimate Booked" instead of creating a duplicate.
 */
export async function ingestLead(
  raw: LeadInput,
  opts: {
    stageKey: string;
    channel: (typeof LEAD_CHANNELS)[number];
    externalSource?: string;
    externalRef?: string | null;
    actorId?: string | null;
  },
): Promise<IngestResult> {
  const input = leadInputSchema.parse(raw);
  const name = fullName(input.firstName, input.lastName) || input.company || input.email || input.phone || "Unnamed lead";

  return db.transaction(async (tx) => {
    const stage = await stageByKey(opts.stageKey, tx);

    // Same external booking seen before → update in place.
    if (opts.externalSource && opts.externalRef) {
      const existing = await tx.query.opportunities.findFirst({
        where: and(eq(opportunities.externalSource, opts.externalSource), eq(opportunities.externalRef, opts.externalRef)),
      });
      if (existing) {
        await tx
          .update(opportunities)
          .set({
            estimateVisitAt: input.visitAt ?? existing.estimateVisitAt,
            bookingManageUrl: input.bookingManageUrl ?? existing.bookingManageUrl,
            updatedAt: new Date(),
          })
          .where(eq(opportunities.id, existing.id));
        await tx.insert(activities).values({
          customerId: existing.customerId,
          opportunityId: existing.id,
          type: "booking",
          body: input.visitAt ? `Booking updated – visit ${input.visitAt.toISOString()}` : "Booking updated",
          meta: { source: opts.externalSource },
        });
        return { opportunityId: existing.id, customerId: existing.customerId, created: false, matchedExistingCustomer: true };
      }
    }

    let customer = await findCustomer(tx, input.email ?? null, input.phone);
    const matchedExistingCustomer = !!customer;
    if (!customer) {
      [customer] = await tx
        .insert(customers)
        .values({
          type: input.propertyType === "Commercial" ? "commercial" : input.propertyType === "Strata Complex" ? "strata" : "residential",
          displayName: input.company && !input.firstName ? input.company : name,
          email: input.email ?? null,
          phone: input.phone,
          source: input.leadSource,
          createdBy: opts.actorId ?? null,
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

    let propertyId: string | null = null;
    if (input.street) {
      const existingProp = await tx.query.properties.findFirst({
        where: and(eq(properties.customerId, customer.id), ilike(properties.street, input.street)),
      });
      if (existingProp) propertyId = existingProp.id;
      else {
        const [p] = await tx
          .insert(properties)
          .values({
            customerId: customer.id,
            street: input.street,
            unit: input.unit,
            city: input.city,
            postalCode: input.postalCode,
            propertyType: mapPropertyType(input.propertyType),
          })
          .returning();
        propertyId = p.id;
      }
    }

    // A booking from someone with an open, un-booked lead promotes that lead.
    if (opts.stageKey === "estimate_booked") {
      const early = await tx
        .select({ id: opportunities.id })
        .from(opportunities)
        .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
        .where(and(eq(opportunities.customerId, customer.id), inArray(pipelineStages.key, ["new_lead", "contacted", "follow_up"])))
        .limit(1);
      if (early[0]) {
        await tx
          .update(opportunities)
          .set({
            stageId: stage.id,
            stageChangedAt: new Date(),
            estimateVisitAt: input.visitAt ?? null,
            bookingRef: input.bookingRef,
            bookingManageUrl: input.bookingManageUrl,
            externalSource: opts.externalSource ?? null,
            externalRef: opts.externalRef ?? null,
            propertyId: propertyId ?? undefined,
            nextFollowUpAt: null,
            updatedAt: new Date(),
          })
          .where(eq(opportunities.id, early[0].id));
        await tx.insert(activities).values({
          customerId: customer.id,
          opportunityId: early[0].id,
          type: "booking",
          body: "Estimate visit booked – moved to Estimate Booked",
          meta: { source: opts.externalSource, visitAt: input.visitAt },
        });
        return { opportunityId: early[0].id, customerId: customer.id, created: false, matchedExistingCustomer };
      }
    }

    const [opp] = await tx
      .insert(opportunities)
      .values({
        title: opportunityTitle(name, input.projectTypes, input.city),
        customerId: customer.id,
        propertyId,
        stageId: stage.id,
        source: input.leadSource,
        channel: opts.channel,
        projectTypes: input.projectTypes,
        description: input.description,
        timeline: input.timeline,
        estimatorId: input.estimatorId,
        estimateVisitAt: input.visitAt ?? null,
        bookingRef: input.bookingRef,
        bookingManageUrl: input.bookingManageUrl,
        externalSource: opts.externalSource ?? null,
        externalRef: opts.externalRef ?? null,
        createdBy: opts.actorId ?? null,
      })
      .returning();

    await tx.insert(activities).values({
      customerId: customer.id,
      opportunityId: opp.id,
      type: opts.stageKey === "estimate_booked" ? "booking" : "system",
      body:
        opts.stageKey === "estimate_booked"
          ? `Estimate visit booked via ${opts.externalSource ?? opts.channel}`
          : `New lead from ${channelLabel(opts.channel)}`,
      meta: { source: opts.externalSource ?? opts.channel },
      createdBy: opts.actorId ?? null,
    });
    if (input.notes) {
      await tx.insert(activities).values({ customerId: customer.id, opportunityId: opp.id, type: "note", body: input.notes, createdBy: opts.actorId ?? null });
    }
    await audit({ actorId: opts.actorId ?? null, action: "lead.create", entityType: "opportunity", entityId: opp.id, after: { channel: opts.channel } }, tx);
    return { opportunityId: opp.id, customerId: customer.id, created: true, matchedExistingCustomer };
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

export async function moveStage(opportunityId: string, stageId: string, userId: string | null, lostReason?: string | null) {
  return db.transaction(async (tx) => {
    const opp = await tx.query.opportunities.findFirst({ where: eq(opportunities.id, opportunityId) });
    if (!opp) throw new Error("Lead not found");
    const [from, to] = await Promise.all([
      tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, opp.stageId) }),
      tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, stageId) }),
    ]);
    if (!to) throw new Error("Stage not found");
    if (from?.id === to.id) return;
    const now = new Date();
    await tx
      .update(opportunities)
      .set({
        stageId,
        stageChangedAt: now,
        wonAt: to.kind === "won" ? now : null,
        closedAt: to.kind === "open" ? null : now,
        lostReason: to.kind === "lost" ? (lostReason ?? opp.lostReason) : null,
        lastContactedAt: to.key === "contacted" ? now : opp.lastContactedAt,
        updatedAt: now,
      })
      .where(eq(opportunities.id, opportunityId));
    await tx.insert(activities).values({
      customerId: opp.customerId,
      opportunityId,
      type: "stage_change",
      body: `Moved from ${from?.name ?? "?"} to ${to.name}${to.kind === "lost" && lostReason ? ` (${lostReason})` : ""}`,
      createdBy: userId,
    });
    await audit({ actorId: userId, action: "lead.stage", entityType: "opportunity", entityId: opportunityId, before: { stage: from?.key }, after: { stage: to.key } }, tx);
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

/** Store the raw webhook first so nothing is lost if processing fails. */
export async function recordInbound(source: string, externalRef: string | null, payload: unknown) {
  if (externalRef) {
    const dup = await db.query.inboundEvents.findFirst({
      where: and(eq(inboundEvents.source, source), eq(inboundEvents.externalRef, externalRef), eq(inboundEvents.status, "processed")),
    });
    if (dup) return { id: dup.id, duplicate: true, opportunityId: dup.opportunityId };
  }
  const [row] = await db.insert(inboundEvents).values({ source, externalRef, payload: payload as object }).returning();
  return { id: row.id, duplicate: false, opportunityId: null };
}

export async function finishInbound(id: string, result: { opportunityId?: string; error?: string }) {
  await db
    .update(inboundEvents)
    .set({ status: result.error ? "failed" : "processed", error: result.error ?? null, opportunityId: result.opportunityId ?? null, processedAt: new Date() })
    .where(eq(inboundEvents.id, id));
}

export async function searchCustomersByText(q: string) {
  const term = `%${q}%`;
  return db.query.customers.findMany({
    where: and(isNull(customers.archivedAt), or(ilike(customers.displayName, term), ilike(customers.email, term), ilike(customers.phone, term))),
    limit: 10,
  });
}

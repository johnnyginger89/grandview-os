import "server-only";
import { and, asc, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { activities, contacts, customers, estimates, opportunities, pipelineStages, properties, user } from "@/db/schema";
import { can } from "@/lib/authz/permissions";
import { closedWindowDays, LIST_ROW_LIMIT, type ClosedWindow, type PipelineRow } from "@/lib/pipeline/list-view";
import { fullName } from "@/lib/utils";

// Never wrap these in a cache: what they return depends on the viewer's role.

/** One row of query 1, before projection. */
export interface RawRow {
  id: string;
  number: number | null;
  title: string;
  customerId: string;
  customerName: string;
  customerType: string;
  customerEmail: string | null;
  customerPhone: string | null;
  stageId: string;
  stageKey: string;
  stageKind: string;
  stageChangedAt: Date;
  createdAt: Date;
  closedAt: Date | null;
  estimateVisitAt: Date | null;
  firstViewedAt: Date | null;
  nextFollowUpAt: Date | null;
  lastContactedAt: Date | null;
  lastActivityAt: Date | null;
  projectTypes: string[];
  source: string | null;
  channel: string | null;
  timeline: string | null;
  lostReason: string | null;
  contactFirst: string | null;
  contactLast: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  street: string | null;
  unit: string | null;
  city: string | null;
  propertyType: string | null;
  estimatorId: string | null;
  estimatorName: string | null;
  estimatedValue?: string | null;
}

/** The lead's most relevant estimate (query 2). Sell price only; cost and margin are never selected. */
export interface MoneyRow {
  opportunityId: string | null;
  id: string;
  status: string;
  totalPrice: string;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const KINDS = new Set(["open", "won", "lost"]);
const CUSTOMER_TYPES = new Set(["residential", "commercial", "strata"]);

/** Raw DB row → PipelineRow. Money fields are forced to null unless `includeMoney`. */
export function projectRow(raw: RawRow, money: MoneyRow | undefined, includeMoney: boolean): PipelineRow {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    customerId: raw.customerId,
    customerName: raw.customerName,
    customerType: (CUSTOMER_TYPES.has(raw.customerType) ? raw.customerType : "residential") as PipelineRow["customerType"],
    stageId: raw.stageId,
    stageKey: raw.stageKey,
    stageKind: (KINDS.has(raw.stageKind) ? raw.stageKind : "open") as PipelineRow["stageKind"],
    stageChangedAt: raw.stageChangedAt.toISOString(),
    createdAt: raw.createdAt.toISOString(),
    closedAt: iso(raw.closedAt),
    estimateVisitAt: iso(raw.estimateVisitAt),
    firstViewedAt: iso(raw.firstViewedAt),
    nextFollowUpAt: iso(raw.nextFollowUpAt),
    lastContactedAt: iso(raw.lastContactedAt),
    lastActivityAt: iso(raw.lastActivityAt),
    projectTypes: raw.projectTypes ?? [],
    source: raw.source || null,
    channel: raw.channel || null,
    timeline: raw.timeline || null,
    lostReason: raw.lostReason || null,
    contactName: fullName(raw.contactFirst, raw.contactLast) || null,
    // Same rule as the lead page: the primary contact's details first, then the customer's.
    email: raw.contactEmail || raw.customerEmail || null,
    phone: raw.contactPhone || raw.customerPhone || null,
    street: raw.street || null,
    unit: raw.unit || null,
    city: raw.city || null,
    propertyType: raw.propertyType || null,
    estimatorId: raw.estimatorId,
    estimatorName: raw.estimatorName,
    estimatedValue: includeMoney ? (raw.estimatedValue ?? null) : null,
    estimateId: includeMoney ? (money?.id ?? null) : null,
    estimateTotal: includeMoney ? (money?.totalPrice ?? null) : null,
    estimateStatus: includeMoney ? (money?.status ?? null) : null,
  };
}

/** Every open lead plus won/lost leads closed inside the window, capped at LIST_ROW_LIMIT. */
export async function listPipelineRows(opts: { closed: ClosedWindow; includeMoney: boolean; now?: Date }): Promise<{ rows: PipelineRow[]; truncated: boolean }> {
  const now = opts.now ?? new Date();
  const estimator = alias(user, "estimator");
  const pc = db
    .select({ firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone })
    .from(contacts)
    .where(and(eq(contacts.customerId, opportunities.customerId), eq(contacts.isPrimary, true)))
    .orderBy(asc(contacts.createdAt))
    .limit(1)
    .as("pc");
  // Automatic "system" entries (follow-up set, lead opened) aren't contact with the customer.
  const lastActivityAt = sql<Date | null>`(select max(${activities.createdAt}) from ${activities}
    where ${activities.opportunityId} = ${opportunities.id} and ${activities.type} <> 'system')`.mapWith(activities.createdAt);
  const days = closedWindowDays(opts.closed);
  const since = days == null ? null : new Date(now.getTime() - days * 86_400_000);

  const raw: RawRow[] = await db
    .select({
      id: opportunities.id,
      number: opportunities.number,
      title: opportunities.title,
      customerId: customers.id,
      customerName: customers.displayName,
      customerType: customers.type,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      stageId: pipelineStages.id,
      stageKey: pipelineStages.key,
      stageKind: pipelineStages.kind,
      stageChangedAt: opportunities.stageChangedAt,
      createdAt: opportunities.createdAt,
      closedAt: opportunities.closedAt,
      estimateVisitAt: opportunities.estimateVisitAt,
      firstViewedAt: opportunities.firstViewedAt,
      nextFollowUpAt: opportunities.nextFollowUpAt,
      lastContactedAt: opportunities.lastContactedAt,
      lastActivityAt,
      projectTypes: opportunities.projectTypes,
      source: opportunities.source,
      channel: opportunities.channel,
      timeline: opportunities.timeline,
      lostReason: opportunities.lostReason,
      contactFirst: pc.firstName,
      contactLast: pc.lastName,
      contactEmail: pc.email,
      contactPhone: pc.phone,
      street: properties.street,
      unit: properties.unit,
      city: properties.city,
      propertyType: properties.propertyType,
      estimatorId: opportunities.estimatorId,
      estimatorName: estimator.name,
      ...(opts.includeMoney ? { estimatedValue: opportunities.estimatedValue } : {}),
    })
    .from(opportunities)
    .innerJoin(customers, eq(customers.id, opportunities.customerId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .leftJoin(properties, eq(properties.id, opportunities.propertyId))
    .leftJoin(estimator, eq(estimator.id, opportunities.estimatorId))
    .leftJoinLateral(pc, sql`true`)
    .where(since ? or(eq(pipelineStages.kind, "open"), gte(opportunities.closedAt, since)) : undefined)
    .orderBy(asc(pipelineStages.position), asc(opportunities.stageChangedAt))
    .limit(LIST_ROW_LIMIT + 1);

  const truncated = raw.length > LIST_ROW_LIMIT;
  const kept = truncated ? raw.slice(0, LIST_ROW_LIMIT) : raw;

  const moneyByOpp = new Map<string, MoneyRow>();
  if (opts.includeMoney && kept.length) {
    const money = await db
      .selectDistinctOn([estimates.opportunityId], {
        opportunityId: estimates.opportunityId,
        id: estimates.id,
        status: estimates.status,
        totalPrice: sql<string>`${estimates.totalPrice}::text`,
      })
      .from(estimates)
      .where(and(inArray(estimates.opportunityId, kept.map((r) => r.id)), ne(estimates.status, "archived")))
      .orderBy(
        estimates.opportunityId,
        sql`case ${estimates.status} when 'accepted' then 0 when 'sent' then 1 when 'draft' then 2 else 3 end`,
        desc(estimates.updatedAt),
      );
    for (const m of money) if (m.opportunityId) moneyByOpp.set(m.opportunityId, m);
  }

  return { rows: kept.map((r) => projectRow(r, moneyByOpp.get(r.id), opts.includeMoney)), truncated };
}

/** Active people who can be assigned leads: anyone whose role can write estimates. */
export async function listAssignableEstimators(): Promise<{ id: string; name: string }[]> {
  const rows = await db.select({ id: user.id, name: user.name, role: user.role }).from(user).where(eq(user.active, true)).orderBy(asc(user.name));
  return rows.filter((u) => can(u.role, "estimates.write")).map(({ id, name }) => ({ id, name }));
}

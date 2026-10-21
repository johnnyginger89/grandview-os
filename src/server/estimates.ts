import "server-only";
import { and, asc, desc, eq, gte, isNotNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activities,
  estimateAreas,
  estimateCostItems,
  estimateLines,
  estimateRevisions,
  estimates,
  estimateTemplates,
  opportunities,
  properties,
  type EstimateStatus,
} from "@/db/schema";
import { calculateDoc, estimateDocSchema, resolvedQuantity, totalsToStrings, type EstimateDoc } from "@/lib/estimating/document";
import { toDb } from "@/lib/money";
import { audit } from "./audit";
import { getRateSnapshot } from "./rates";
import { getPricing } from "./settings";

export class EstimateLockedError extends Error {
  readonly expose = true;
  constructor() {
    super("This estimate has been accepted and is locked. Create a change order or a new revision instead.");
  }
}

const JOB_TITLES: Record<string, string> = {
  interior: "Interior repaint",
  exterior: "Exterior repaint",
  interior_exterior: "Interior & exterior repaint",
  cabinets: "Cabinet painting",
  staining: "Deck / fence staining",
  commercial: "Commercial painting",
  strata: "Strata painting",
  repairs: "Repairs",
};

export async function createEstimate(
  input: { customerId?: string | null; opportunityId?: string | null; propertyId?: string | null; title?: string; jobType?: string; templateId?: string | null },
  userId: string,
) {
  let { customerId, propertyId } = input;
  let title = input.title;
  if (input.opportunityId) {
    const opp = await db.query.opportunities.findFirst({ where: eq(opportunities.id, input.opportunityId) });
    if (!opp) throw new Error("Lead not found");
    customerId = opp.customerId;
    propertyId = propertyId ?? opp.propertyId;
    title = title || opp.projectTypes.join(" & ") || "Painting";
  }
  if (!customerId) throw new Error("Choose a customer");
  if (!propertyId) {
    const p = await db.query.properties.findFirst({ where: eq(properties.customerId, customerId) });
    propertyId = p?.id ?? null;
  }
  if (!title) {
    // "Interior repaint – 1 Example St": rename it in the editor if you like.
    const street = propertyId ? (await db.query.properties.findFirst({ where: eq(properties.id, propertyId), columns: { street: true } }))?.street : null;
    title = [JOB_TITLES[input.jobType ?? "interior"] ?? "Painting", street].filter(Boolean).join(" – ");
  }
  const pricing = await getPricing();
  const validUntil = new Date(Date.now() + pricing.estimateValidDays * 86_400_000);
  const [row] = await db
    .insert(estimates)
    .values({
      title: title || "Painting",
      customerId,
      propertyId,
      opportunityId: input.opportunityId ?? null,
      jobType: input.jobType || "interior",
      pricingMethod: pricing.pricingMethod,
      laborCostPerHour: pricing.laborCostPerHour,
      billingRatePerHour: pricing.billingRatePerHour,
      targetMargin: pricing.targetMargin,
      materialMarkupPct: pricing.materialMarkupPct,
      minimumJobPrice: pricing.minimumJobPrice,
      gstRate: pricing.gstRate,
      depositPct: pricing.depositPct,
      validUntil,
      estimatorId: userId,
      createdBy: userId,
    })
    .returning();
  await db.insert(activities).values({ customerId, opportunityId: input.opportunityId ?? null, type: "estimate", body: `Estimate #${row.number} created`, createdBy: userId });
  await audit({ actorId: userId, action: "estimate.create", entityType: "estimate", entityId: row.id });
  if (input.templateId) {
    // Same as "Add from template" in the editor, done before the estimate first opens.
    const [parts, loaded] = await Promise.all([templateToDocParts(input.templateId), loadEstimate(row.id)]);
    if (loaded) await saveEstimateDoc(row.id, { ...loaded.doc, areas: parts.areas, lines: parts.lines, costItems: parts.costItems });
  }
  return row;
}

export async function loadEstimate(id: string) {
  const est = await db.query.estimates.findFirst({ where: eq(estimates.id, id) });
  if (!est) return null;
  const [areas, lines, costItems] = await Promise.all([
    db.query.estimateAreas.findMany({ where: eq(estimateAreas.estimateId, id), orderBy: asc(estimateAreas.position) }),
    db.query.estimateLines.findMany({ where: eq(estimateLines.estimateId, id), orderBy: asc(estimateLines.position) }),
    db.query.estimateCostItems.findMany({ where: eq(estimateCostItems.estimateId, id), orderBy: asc(estimateCostItems.position) }),
  ]);
  const doc: EstimateDoc = {
    title: est.title,
    jobType: est.jobType,
    contractType: est.contractType,
    internalNotes: est.internalNotes,
    customerNotes: est.customerNotes,
    poNumber: est.poNumber,
    areasExcluded: est.areasExcluded,
    preparationOverride: est.preparationOverride,
    settings: {
      pricingMethod: est.pricingMethod,
      laborCostPerHour: est.laborCostPerHour,
      billingRatePerHour: est.billingRatePerHour,
      targetMargin: est.targetMargin,
      materialMarkupPct: est.materialMarkupPct,
      minimumJobPrice: est.minimumJobPrice,
      gstRate: est.gstRate,
      depositPct: est.depositPct,
      discount: est.discount,
      priceOverride: est.priceOverride,
    },
    areas: areas.map((a) => ({ id: a.id, parentId: a.parentId, name: a.name, kind: a.kind, length: a.length, width: a.width, height: a.height, notes: a.notes, customerDescription: a.customerDescription })),
    lines: lines.map((l) => ({
      id: l.id,
      areaId: l.areaId,
      description: l.description,
      customerDescription: l.customerDescription,
      customerDetail: l.customerDetail,
      rateSnapshot: l.rateSnapshot,
      quantity: l.quantity,
      quantitySource: l.quantitySource,
      coats: l.coats,
      prepFactor: l.prepFactor,
      difficultyFactor: l.difficultyFactor,
      conditionFactor: l.conditionFactor,
      accessFactor: l.accessFactor,
      colour: l.colour,
      sheen: l.sheen,
      overrideHours: l.overrideHours,
      overridePrice: l.overridePrice,
      isOptional: l.isOptional,
      optionSelected: l.optionSelected,
    })),
    costItems: costItems.map((c) => ({
      id: c.id,
      kind: c.kind,
      description: c.description,
      customerDescription: c.customerDescription,
      cost: c.cost,
      markupPct: c.markupPct,
      overridePrice: c.overridePrice,
      isOptional: c.isOptional,
      optionSelected: c.optionSelected,
    })),
  };
  return { estimate: est, doc };
}

/** Replace the estimate's contents with the editor document and refresh cached totals. */
export async function saveEstimateDoc(id: string, raw: unknown) {
  const doc = estimateDocSchema.parse(raw);
  const result = calculateDoc(doc); // throws on invalid math (e.g. zero production rate)
  return db.transaction(async (tx) => {
    const est = await tx.query.estimates.findFirst({ where: eq(estimates.id, id) });
    if (!est) throw new Error("Estimate not found");
    if (est.status === "accepted") throw new EstimateLockedError();

    const areaIds = new Set(doc.areas.map((a) => a.id));
    for (const a of doc.areas) if (a.parentId && !areaIds.has(a.parentId)) throw new Error("Area parent missing");
    for (const l of doc.lines) if (l.areaId && !areaIds.has(l.areaId)) throw new Error("Line area missing");

    await tx.delete(estimateLines).where(eq(estimateLines.estimateId, id));
    await tx.delete(estimateCostItems).where(eq(estimateCostItems.estimateId, id));
    await tx.delete(estimateAreas).where(eq(estimateAreas.estimateId, id));

    // Parents before children so the self-reference is satisfied.
    const ordered = [...doc.areas].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
    if (ordered.length) {
      await tx.insert(estimateAreas).values(
        ordered.map((a) => ({ ...a, estimateId: id, position: doc.areas.indexOf(a), notes: a.notes ?? null, customerDescription: a.customerDescription ?? null })),
      );
    }
    const areas = new Map(doc.areas.map((a) => [a.id, a]));
    if (doc.lines.length) {
      await tx.insert(estimateLines).values(
        doc.lines.map((l, i) => ({
          ...l,
          estimateId: id,
          position: i,
          quantity: resolvedQuantity(l, l.areaId ? areas.get(l.areaId) : undefined),
          customerDescription: l.customerDescription ?? null,
          customerDetail: l.customerDetail ?? null,
          colour: l.colour ?? null,
          sheen: l.sheen ?? null,
        })),
      );
    }
    if (doc.costItems.length) {
      await tx.insert(estimateCostItems).values(doc.costItems.map((c, i) => ({ ...c, estimateId: id, position: i, customerDescription: c.customerDescription ?? null })));
    }
    const t = result.totals;
    await tx
      .update(estimates)
      .set({
        title: doc.title,
        jobType: doc.jobType,
        contractType: doc.contractType,
        internalNotes: doc.internalNotes ?? null,
        customerNotes: doc.customerNotes ?? null,
        poNumber: doc.poNumber ?? null,
        areasExcluded: doc.areasExcluded ?? null,
        preparationOverride: doc.preparationOverride ?? null,
        ...doc.settings,
        discount: doc.settings.discount ?? null,
        priceOverride: doc.settings.priceOverride ?? null,
        totalHours: toDb(t.hours, 4),
        totalCost: toDb(t.totalCost),
        totalPrice: toDb(t.price),
        totalWithTax: toDb(t.total),
        updatedAt: new Date(),
      })
      .where(eq(estimates.id, id));
    return { totals: totalsToStrings(result), updatedAt: new Date().toISOString() };
  });
}

export async function createRevision(id: string, reason: string | null, userId: string) {
  const loaded = await loadEstimate(id);
  if (!loaded) throw new Error("Estimate not found");
  const totals = totalsToStrings(calculateDoc(loaded.doc));
  return db.transaction(async (tx) => {
    const [{ latest }] = await tx.select({ latest: max(estimateRevisions.revision) }).from(estimateRevisions).where(eq(estimateRevisions.estimateId, id));
    const revision = (latest ?? 0) + 1;
    await tx.insert(estimateRevisions).values({ estimateId: id, revision, reason, snapshot: loaded.doc, totals, createdBy: userId });
    await tx.update(estimates).set({ revision }).where(eq(estimates.id, id));
    await audit({ actorId: userId, action: "estimate.revision", entityType: "estimate", entityId: id, after: { revision, reason } }, tx);
    return revision;
  });
}

export async function listRevisions(id: string) {
  return db.query.estimateRevisions.findMany({ where: eq(estimateRevisions.estimateId, id), orderBy: desc(estimateRevisions.revision) });
}

export async function restoreRevision(id: string, revision: number, userId: string) {
  const rev = await db.query.estimateRevisions.findFirst({ where: (t, { and, eq }) => and(eq(t.estimateId, id), eq(t.revision, revision)) });
  if (!rev) throw new Error("Revision not found");
  await createRevision(id, `Auto-saved before restoring revision ${revision}`, userId);
  return saveEstimateDoc(id, rev.snapshot);
}

const ALLOWED: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ["sent", "archived"],
  sent: ["draft", "declined", "expired", "archived"],
  declined: ["draft", "archived"],
  expired: ["draft", "archived"],
  archived: ["draft"],
  accepted: [],
};

export async function setEstimateStatus(id: string, status: EstimateStatus, userId: string) {
  const est = await db.query.estimates.findFirst({ where: eq(estimates.id, id) });
  if (!est) throw new Error("Estimate not found");
  if (!ALLOWED[est.status].includes(status)) throw new Error(`Can't change an estimate from ${est.status} to ${status}`);
  if (status === "sent") await createRevision(id, "Sent to customer", userId);
  await db.update(estimates).set({ status, sentAt: status === "sent" ? new Date() : est.sentAt, updatedAt: new Date() }).where(eq(estimates.id, id));
  await db.insert(activities).values({ customerId: est.customerId, opportunityId: est.opportunityId, type: "estimate", body: `Estimate #${est.number} marked ${status}`, createdBy: userId });
  await audit({ actorId: userId, action: "estimate.status", entityType: "estimate", entityId: id, before: { status: est.status }, after: { status } });
}

export async function duplicateEstimate(id: string, userId: string) {
  const loaded = await loadEstimate(id);
  if (!loaded) throw new Error("Estimate not found");
  const copy = await createEstimate(
    { customerId: loaded.estimate.customerId, propertyId: loaded.estimate.propertyId, opportunityId: loaded.estimate.opportunityId, title: `${loaded.estimate.title} (copy)`, jobType: loaded.estimate.jobType },
    userId,
  );
  const remap = new Map<string, string>();
  const newId = (old: string) => remap.get(old) ?? (remap.set(old, crypto.randomUUID()), remap.get(old)!);
  const doc: EstimateDoc = {
    ...loaded.doc,
    title: copy.title,
    areas: loaded.doc.areas.map((a) => ({ ...a, id: newId(a.id), parentId: a.parentId ? newId(a.parentId) : null })),
    lines: loaded.doc.lines.map((l) => ({ ...l, id: crypto.randomUUID(), areaId: l.areaId ? newId(l.areaId) : null })),
    costItems: loaded.doc.costItems.map((c) => ({ ...c, id: crypto.randomUUID() })),
  };
  await saveEstimateDoc(copy.id, doc);
  return copy;
}

/** Templates store rate ids; applying them always uses the current rate versions. */
export async function saveAsTemplate(id: string, name: string, userId: string) {
  const loaded = await loadEstimate(id);
  if (!loaded) throw new Error("Estimate not found");
  const payload = {
    areas: loaded.doc.areas,
    lines: loaded.doc.lines.map(({ rateSnapshot, ...l }) => ({ ...l, rateId: rateSnapshot.rateId ?? null, fallback: rateSnapshot })),
    costItems: loaded.doc.costItems,
  };
  const [row] = await db.insert(estimateTemplates).values({ name, jobType: loaded.estimate.jobType, payload, createdBy: userId }).returning();
  return row;
}

export async function listTemplates() {
  return db.query.estimateTemplates.findMany({ orderBy: asc(estimateTemplates.name) });
}

type TemplatePayload = {
  areas: EstimateDoc["areas"];
  lines: (Omit<EstimateDoc["lines"][number], "rateSnapshot"> & { rateId: string | null; fallback: EstimateDoc["lines"][number]["rateSnapshot"] })[];
  costItems: EstimateDoc["costItems"];
};

/** Append a template's areas and lines (with fresh ids and current rates) to an estimate document. */
export async function templateToDocParts(templateId: string) {
  const t = await db.query.estimateTemplates.findFirst({ where: eq(estimateTemplates.id, templateId) });
  if (!t) throw new Error("Template not found");
  const p = t.payload as TemplatePayload;
  const remap = new Map<string, string>();
  const newId = (old: string) => remap.get(old) ?? (remap.set(old, crypto.randomUUID()), remap.get(old)!);
  const snapshots = new Map<string, Awaited<ReturnType<typeof getRateSnapshot>>>();
  for (const l of p.lines) if (l.rateId && !snapshots.has(l.rateId)) snapshots.set(l.rateId, await getRateSnapshot(l.rateId));
  return {
    areas: p.areas.map((a) => ({ ...a, id: newId(a.id), parentId: a.parentId ? newId(a.parentId) : null })),
    lines: p.lines.map(({ rateId, fallback, ...l }) => ({
      ...l,
      id: crypto.randomUUID(),
      areaId: l.areaId ? newId(l.areaId) : null,
      rateSnapshot: (rateId && snapshots.get(rateId)) || fallback,
    })),
    costItems: p.costItems.map((c) => ({ ...c, id: crypto.randomUUID() })),
  };
}

/** Colours used on estimates in the last 60 days, most used first (for the colour picker). */
export async function recentColours(now = new Date(), limit = 20): Promise<string[]> {
  const rows = await db
    .select({ colour: sql<string>`min(trim(${estimateLines.colour}))`, n: sql<number>`count(*)::int` })
    .from(estimateLines)
    .innerJoin(estimates, eq(estimates.id, estimateLines.estimateId))
    .where(and(isNotNull(estimateLines.colour), sql`trim(${estimateLines.colour}) <> ''`, gte(estimates.updatedAt, new Date(now.getTime() - 60 * 86_400_000))))
    .groupBy(sql`lower(trim(${estimateLines.colour}))`)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows.map((r) => r.colour);
}

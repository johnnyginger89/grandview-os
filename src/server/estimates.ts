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
import type { EstimateResult } from "@/lib/estimating/engine";
import { toDb } from "@/lib/money";
import { audit } from "./audit";
import { getRateSnapshot } from "./rates";
import { getPricing } from "./settings";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class EstimateLockedError extends Error {
  readonly expose = true;
  constructor() {
    super("This estimate has been accepted and is locked. Create a change order or a new revision instead.");
  }
}

/** The screen was working from an older copy: another device or tab saved, sent or accepted it since. */
export class EstimateStaleError extends Error {
  readonly expose = true;
  constructor() {
    super("This estimate was changed on another device or tab. Reload to see the latest.");
  }
}

/**
 * `updatedAt` is the estimate's version. Screens send back the one they loaded; a different
 * stored version means someone else changed it first. Null means the caller doesn't track one.
 */
export function assertCurrentVersion(est: { updatedAt: Date }, expected: string | null | undefined) {
  if (expected != null && new Date(expected).getTime() !== est.updatedAt.getTime()) throw new EstimateStaleError();
}

/** The next version: now, but always later than the current one, so a server clock running behind can't repeat a version. */
export function nextVersion(est: { updatedAt: Date }, now = new Date()): Date {
  return new Date(Math.max(now.getTime(), est.updatedAt.getTime() + 1));
}

/**
 * Locks the estimate row for the rest of the transaction. Everything that writes an estimate
 * (saves, sends, signatures, declines, status changes) takes this lock before touching its
 * proposals or contents, so racing requests queue up and each sees what the one before did.
 */
export async function lockEstimate(tx: Tx, id: string) {
  const [row] = await tx.select().from(estimates).where(eq(estimates.id, id)).for("update");
  return row ?? null;
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
  // No validUntil yet: a quote is valid from the day it's sent (see freezeProposal).
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
      finalPriceBeforeUpgrades: true,
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

/** The estimate and its document. Pass the transaction to read the copy that lockEstimate is holding. */
export async function loadEstimate(id: string, q: typeof db | Tx = db) {
  const est = await q.query.estimates.findFirst({ where: eq(estimates.id, id) });
  if (!est) return null;
  const [areas, lines, costItems] = await loadParts(id, q);
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
      finalPriceBeforeUpgrades: est.finalPriceBeforeUpgrades,
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

async function loadParts(id: string, q: typeof db | Tx) {
  const areas = () => q.query.estimateAreas.findMany({ where: eq(estimateAreas.estimateId, id), orderBy: asc(estimateAreas.position) });
  const lines = () => q.query.estimateLines.findMany({ where: eq(estimateLines.estimateId, id), orderBy: asc(estimateLines.position) });
  const costItems = () => q.query.estimateCostItems.findMany({ where: eq(estimateCostItems.estimateId, id), orderBy: asc(estimateCostItems.position) });
  if (q === db) return Promise.all([areas(), lines(), costItems()]);
  // A transaction has a single connection, so its queries go one at a time.
  return [await areas(), await lines(), await costItems()] as const;
}

/**
 * Replace the estimate's contents with the editor document and refresh cached totals.
 * `expectedUpdatedAt` is the version the editor loaded or last saved: when another device or
 * tab saved in between, the save is refused instead of overwriting their work.
 */
export async function saveEstimateDoc(id: string, raw: unknown, expectedUpdatedAt?: string | null) {
  const parsed = estimateDocSchema.parse(raw);
  return db.transaction(async (tx) => {
    const est = await lockEstimate(tx, id);
    if (!est) throw new Error("Estimate not found");
    if (est.status === "accepted") throw new EstimateLockedError();
    assertCurrentVersion(est, expectedUpdatedAt);
    // The pricing rule belongs to the estimate, never to what the browser sends.
    const doc = { ...parsed, settings: { ...parsed.settings, finalPriceBeforeUpgrades: est.finalPriceBeforeUpgrades } };
    const result = calculateDoc(doc); // throws on invalid math (e.g. zero production rate)
    const now = nextVersion(est);
    await writeEstimateDoc(tx, id, doc, { result, now });
    return { totals: totalsToStrings(result), updatedAt: now.toISOString() };
  });
}

/**
 * Writes the document's areas, lines and extras over the estimate's and refreshes the cached
 * totals; `set` adds columns to the same update. The caller holds the lock and checked the version.
 */
export async function writeEstimateDoc(
  tx: Tx,
  id: string,
  doc: EstimateDoc,
  opts: { result?: EstimateResult; now: Date; set?: Partial<typeof estimates.$inferInsert> },
): Promise<EstimateResult> {
  const result = opts.result ?? calculateDoc(doc);
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
      updatedAt: opts.now,
      ...opts.set,
    })
    .where(eq(estimates.id, id));
  return result;
}

export async function createRevision(id: string, reason: string | null, userId: string) {
  return db.transaction(async (tx) => {
    if (!(await lockEstimate(tx, id))) throw new Error("Estimate not found");
    const loaded = await loadEstimate(id, tx);
    return insertRevision(tx, id, loaded!.doc, reason, userId);
  });
}

/** Saves `doc` as the estimate's next numbered version, inside the caller's transaction (which holds the lock). */
export async function insertRevision(tx: Tx, id: string, doc: EstimateDoc, reason: string | null, userId: string): Promise<number> {
  const totals = totalsToStrings(calculateDoc(doc));
  const [{ latest }] = await tx.select({ latest: max(estimateRevisions.revision) }).from(estimateRevisions).where(eq(estimateRevisions.estimateId, id));
  const revision = (latest ?? 0) + 1;
  await tx.insert(estimateRevisions).values({ estimateId: id, revision, reason, snapshot: doc, totals, createdBy: userId });
  await tx.update(estimates).set({ revision }).where(eq(estimates.id, id));
  await audit({ actorId: userId, action: "estimate.revision", entityType: "estimate", entityId: id, after: { revision, reason } }, tx);
  return revision;
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

/**
 * The office's status changes (Mark as sent, Mark declined, Back to draft), decided under the
 * row lock so a signature arriving at the same moment can't be undone. `expectedUpdatedAt` is
 * the version on screen; the new version is returned.
 */
export async function setEstimateStatus(id: string, status: EstimateStatus, userId: string, expectedUpdatedAt?: string | null) {
  return db.transaction(async (tx) => {
    const est = await lockEstimate(tx, id);
    if (!est) throw new Error("Estimate not found");
    assertCurrentVersion(est, expectedUpdatedAt);
    if (!ALLOWED[est.status].includes(status)) throw new Error(`Can't change an estimate from ${est.status} to ${status}`);
    const now = nextVersion(est);
    if (status === "sent") {
      const loaded = await loadEstimate(id, tx);
      await insertRevision(tx, id, loaded!.doc, "Sent to customer", userId);
    }
    await tx.update(estimates).set({ status, sentAt: status === "sent" ? now : est.sentAt, updatedAt: now }).where(eq(estimates.id, id));
    await tx.insert(activities).values({ customerId: est.customerId, opportunityId: est.opportunityId, type: "estimate", body: `Estimate #${est.number} marked ${status}`, createdBy: userId });
    await audit({ actorId: userId, action: "estimate.status", entityType: "estimate", entityId: id, before: { status: est.status }, after: { status } }, tx);
    return { updatedAt: now.toISOString() };
  });
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

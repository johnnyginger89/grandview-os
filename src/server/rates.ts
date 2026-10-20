import "server-only";
import { asc, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { factorOptions, materialPriceHistory, materials, productionRates, productionRateVersions } from "@/db/schema";
import type { RateSnapshot } from "@/lib/estimating/engine";
import { audit } from "./audit";

const dec = (opts: { min?: number; max?: number } = {}) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/, "Enter a number")
    .refine((v) => opts.min === undefined || Number(v) >= opts.min, `Must be at least ${opts.min}`)
    .refine((v) => opts.max === undefined || Number(v) <= opts.max, `Must be at most ${opts.max}`);
const optDec = (opts: { min?: number; max?: number } = {}) =>
  z.union([z.literal("").transform(() => null), dec(opts)]).optional().nullable().transform((v) => v ?? null);

export const rateValuesSchema = z.object({
  productionRate: dec({ min: 0.0001 }),
  additionalCoatFactor: dec({ min: 0, max: 2 }),
  defaultCoats: z.coerce.number().int().min(0).max(6),
  laborCostPerHour: optDec({ min: 0 }),
  billingRatePerHour: optDec({ min: 0 }),
  materialId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
  coverageOverride: optDec({ min: 1 }),
  materialWastePct: dec({ min: 0, max: 1 }),
  otherCostPerUnit: dec({ min: 0 }),
  prepNotes: z.string().max(2000).optional().nullable(),
  crewNotes: z.string().max(2000).optional().nullable(),
  changeNote: z.string().max(500).optional().nullable(),
});

export const rateIdentitySchema = z.object({
  code: z.string().trim().min(1).max(40).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(200),
  customerLabel: z.string().trim().max(200).optional().nullable(),
  category: z.string().trim().min(1).max(60),
  unit: z.enum(["sqft", "lnft", "each", "hour"]),
  basis: z.enum(["units_per_hour", "hours_per_unit"]),
  dimensionSource: z.enum(["manual", "walls", "ceiling", "floor", "perimeter"]).default("manual"),
});

export async function listRates(includeInactive = false) {
  const rows = await db
    .select({ rate: productionRates, version: productionRateVersions, material: materials })
    .from(productionRates)
    .leftJoin(productionRateVersions, eq(productionRateVersions.id, productionRates.currentVersionId))
    .leftJoin(materials, eq(materials.id, productionRateVersions.materialId))
    .orderBy(asc(productionRates.category), asc(productionRates.position), asc(productionRates.name));
  return rows.filter((r) => includeInactive || r.rate.active);
}

export type RateRow = Awaited<ReturnType<typeof listRates>>[number];

/** Build the immutable snapshot copied onto an estimate line. */
export function toSnapshot(r: RateRow): RateSnapshot {
  const v = r.version!;
  const m = r.material;
  return {
    rateId: r.rate.id,
    rateVersion: v.version,
    name: r.rate.name,
    unit: r.rate.unit,
    basis: r.rate.basis,
    productionRate: v.productionRate,
    additionalCoatFactor: v.additionalCoatFactor,
    defaultCoats: v.defaultCoats,
    laborCostPerHour: v.laborCostPerHour,
    billingRatePerHour: v.billingRatePerHour,
    material: m
      ? {
          productId: m.id,
          productName: [m.manufacturer, m.name, m.finish].filter(Boolean).join(" "),
          coverage: v.coverageOverride ?? m.coverage,
          pricePerGallon: m.pricePerGallon,
          containerGallons: m.containerGallons,
        }
      : null,
    materialWastePct: v.materialWastePct,
    otherCostPerUnit: v.otherCostPerUnit,
  };
}

export async function getRateSnapshot(rateId: string): Promise<RateSnapshot | null> {
  const rows = await db
    .select({ rate: productionRates, version: productionRateVersions, material: materials })
    .from(productionRates)
    .innerJoin(productionRateVersions, eq(productionRateVersions.id, productionRates.currentVersionId))
    .leftJoin(materials, eq(materials.id, productionRateVersions.materialId))
    .where(eq(productionRates.id, rateId));
  return rows[0] ? toSnapshot(rows[0]) : null;
}

/** Editing a rate never overwrites: it adds a new version and points the rate at it. */
export async function saveRateVersion(rateId: string, values: z.input<typeof rateValuesSchema>, userId: string) {
  const v = rateValuesSchema.parse(values);
  return db.transaction(async (tx) => {
    const [{ latest }] = await tx.select({ latest: max(productionRateVersions.version) }).from(productionRateVersions).where(eq(productionRateVersions.rateId, rateId));
    const [row] = await tx
      .insert(productionRateVersions)
      .values({ ...v, rateId, version: (latest ?? 0) + 1, createdBy: userId })
      .returning();
    await tx.update(productionRates).set({ currentVersionId: row.id }).where(eq(productionRates.id, rateId));
    await audit({ actorId: userId, action: "rate.version", entityType: "production_rate", entityId: rateId, after: { version: row.version, ...v } }, tx);
    return row;
  });
}

export async function updateRateIdentity(rateId: string, values: z.input<typeof rateIdentitySchema>, userId: string) {
  const v = rateIdentitySchema.parse(values);
  await db.update(productionRates).set(v).where(eq(productionRates.id, rateId));
  await audit({ actorId: userId, action: "rate.update", entityType: "production_rate", entityId: rateId, after: v });
}

export async function createRate(identity: z.input<typeof rateIdentitySchema>, values: z.input<typeof rateValuesSchema>, userId: string) {
  const id = rateIdentitySchema.parse(identity);
  const [rate] = await db.insert(productionRates).values(id).returning();
  await saveRateVersion(rate.id, values, userId);
  return rate;
}

export async function setRateActive(rateId: string, active: boolean, userId: string) {
  await db.update(productionRates).set({ active }).where(eq(productionRates.id, rateId));
  await audit({ actorId: userId, action: active ? "rate.activate" : "rate.archive", entityType: "production_rate", entityId: rateId });
}

export async function rateHistory(rateId: string) {
  return db.query.productionRateVersions.findMany({ where: eq(productionRateVersions.rateId, rateId), orderBy: desc(productionRateVersions.version) });
}

export const materialSchema = z.object({
  manufacturer: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  finish: z.string().trim().max(60).optional().nullable(),
  category: z.string().trim().max(60).default("paint"),
  containerGallons: dec({ min: 0.01 }),
  pricePerGallon: dec({ min: 0 }),
  coverage: dec({ min: 1 }),
  supplier: z.string().trim().max(100).optional().nullable(),
  sku: z.string().trim().max(60).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export async function saveMaterial(id: string | null, values: z.input<typeof materialSchema>, userId: string) {
  const v = materialSchema.parse(values);
  return db.transaction(async (tx) => {
    if (!id) {
      const [row] = await tx.insert(materials).values(v).returning();
      await tx.insert(materialPriceHistory).values({ materialId: row.id, pricePerGallon: row.pricePerGallon, recordedBy: userId });
      await audit({ actorId: userId, action: "material.create", entityType: "material", entityId: row.id, after: v }, tx);
      return row;
    }
    const before = await tx.query.materials.findFirst({ where: eq(materials.id, id) });
    if (!before) throw new Error("Material not found");
    const [row] = await tx.update(materials).set({ ...v, updatedAt: new Date() }).where(eq(materials.id, id)).returning();
    if (Number(before.pricePerGallon) !== Number(row.pricePerGallon)) {
      await tx.insert(materialPriceHistory).values({ materialId: id, pricePerGallon: row.pricePerGallon, recordedBy: userId });
    }
    await audit({ actorId: userId, action: "material.update", entityType: "material", entityId: id, before, after: v }, tx);
    return row;
  });
}

export async function listFactors() {
  return db.query.factorOptions.findMany({ orderBy: [asc(factorOptions.kind), asc(factorOptions.position)] });
}

export const factorSchema = z.object({
  kind: z.enum(["prep", "difficulty", "condition", "access"]),
  label: z.string().trim().min(1).max(100),
  value: dec({ min: 0.1, max: 5 }),
});

export async function saveFactor(id: string | null, values: z.input<typeof factorSchema>, userId: string) {
  const v = factorSchema.parse(values);
  if (id) await db.update(factorOptions).set(v).where(eq(factorOptions.id, id));
  else await db.insert(factorOptions).values({ ...v, position: 99 });
  await audit({ actorId: userId, action: "factor.save", entityType: "factor_option", entityId: id, after: v });
}

export async function deleteFactor(id: string, userId: string) {
  await db.delete(factorOptions).where(eq(factorOptions.id, id));
  await audit({ actorId: userId, action: "factor.delete", entityType: "factor_option", entityId: id });
}

/**
 * The estimate "document": everything the editor edits, in one serializable
 * shape. Used by the browser for instant recalculation and by the server for
 * the authoritative save, so both always agree.
 */
import { z } from "zod";
import { d } from "@/lib/money";
import {
  calculateEstimate,
  quantityFromDimensions,
  type CostItemInput,
  type DimensionSource,
  type EstimateResult,
  type EstimateSettings,
  type LineInput,
  type RateSnapshot,
} from "./engine";

const num = z.string().regex(/^-?\d*(\.\d+)?$/, "Enter a number");
const optNum = num.nullable().optional().transform((v) => (v === "" || v === undefined ? null : v));

// Price settings must fit their columns (percents numeric(6,4), money numeric(14,2)) so the
// totals worked out before saving are the totals of what is stored, not of a rounded copy.
const NUMBER_RE = /^-?\d*\.?\d+$/;
const MONEY_LIMIT = "1e12";

/** A percent stored as a fraction (0.2 = 20%): 0–100%, to hundredths of a percent. */
function percentSettingProblem(value: string, label: string): string | null {
  if (!NUMBER_RE.test(value)) return `${label} must be a number`;
  const v = d(value);
  if (v.lt(0) || v.gt(1)) return `${label} must be between 0% and 100%`;
  if (v.decimalPlaces() > 4) return `${label} can have at most 2 decimal places`;
  return null;
}

/** Dollars and cents, never negative. */
function moneySettingProblem(value: string, label: string): string | null {
  if (!NUMBER_RE.test(value)) return `${label} must be a number`;
  const v = d(value);
  if (v.lt(0)) return `${label} can't be negative`;
  if (v.decimalPlaces() > 2) return `${label} can have at most 2 decimal places`;
  if (v.gte(MONEY_LIMIT)) return `${label} is too large`;
  return null;
}

const checked = (problem: (v: string) => string | null) =>
  z.string().superRefine((v, ctx) => {
    const message = problem(v);
    if (message) ctx.addIssue({ code: "custom", message });
  });
const pct = (label: string) => checked((v) => percentSettingProblem(v, label));
const money = (label: string) => checked((v) => moneySettingProblem(v, label));
const optMoney = (label: string) =>
  checked((v) => (v === "" ? null : moneySettingProblem(v, label)))
    .nullable()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

export const rateSnapshotSchema = z.object({
  rateId: z.string().nullable().optional(),
  rateVersion: z.number().nullable().optional(),
  name: z.string(),
  unit: z.enum(["sqft", "lnft", "each", "hour"]),
  basis: z.enum(["units_per_hour", "hours_per_unit"]),
  productionRate: num,
  additionalCoatFactor: num,
  defaultCoats: z.number().int(),
  laborCostPerHour: optNum,
  billingRatePerHour: optNum,
  material: z
    .object({
      productId: z.string().nullable().optional(),
      productName: z.string(),
      coverage: num,
      pricePerGallon: num,
      containerGallons: optNum,
    })
    .nullable()
    .optional(),
  materialWastePct: num,
  otherCostPerUnit: num,
  // Display-only (proposal wording); the engine ignores them.
  category: z.string().max(60).nullable().optional(),
  customerLabel: z.string().max(200).nullable().optional(),
  proposalGroup: z.string().max(60).nullable().optional(),
  /** The estimator picked this paint by hand; "Use current rate" keeps it. */
  materialOverridden: z.boolean().optional(),
});

export const docSettingsSchema = z.object({
  pricingMethod: z.enum(["target_margin", "billing_rate"]),
  laborCostPerHour: money("Labour cost"),
  billingRatePerHour: money("Billing rate"),
  targetMargin: pct("Target margin"),
  materialMarkupPct: pct("Paint markup"),
  minimumJobPrice: money("Minimum job price"),
  gstRate: pct("GST"),
  depositPct: pct("Deposit"),
  discount: optMoney("Discount"),
  priceOverride: optMoney("Final price"),
  /** Set once when the estimate is created; the server never takes it from the browser. */
  finalPriceBeforeUpgrades: z.boolean().optional(),
});

export const docAreaSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string().max(200),
  kind: z.enum(["room", "elevation", "building", "area", "phase"]),
  length: optNum,
  width: optNum,
  height: optNum,
  notes: z.string().max(5000).nullable().optional(),
  customerDescription: z.string().max(1000).nullable().optional(),
});

export const docLineSchema = z.object({
  id: z.string().uuid(),
  areaId: z.string().uuid().nullable(),
  description: z.string().max(500),
  customerDescription: z.string().max(2000).nullable().optional(),
  customerDetail: z.string().max(3000).nullable().optional(),
  rateSnapshot: rateSnapshotSchema,
  quantity: num,
  quantitySource: z.enum(["manual", "walls", "ceiling", "floor", "perimeter"]),
  coats: z.number().int().min(0).max(10),
  prepFactor: num,
  difficultyFactor: num,
  conditionFactor: num,
  accessFactor: num,
  colour: z.string().max(200).nullable().optional(),
  sheen: z.string().max(100).nullable().optional(),
  overrideHours: optNum,
  overridePrice: optNum,
  isOptional: z.boolean(),
  optionSelected: z.boolean(),
});

export const docCostItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["subcontractor", "equipment", "material", "other"]),
  description: z.string().max(500),
  customerDescription: z.string().max(500).nullable().optional(),
  cost: num,
  markupPct: optNum,
  overridePrice: optNum,
  isOptional: z.boolean(),
  optionSelected: z.boolean(),
});

export const estimateDocSchema = z.object({
  title: z.string().trim().min(1).max(200),
  jobType: z.string().max(40),
  contractType: z.enum(["fixed_price", "time_and_materials"]),
  internalNotes: z.string().max(10000).nullable().optional(),
  customerNotes: z.string().max(10000).nullable().optional(),
  poNumber: z.string().trim().max(60).nullable().optional(),
  areasExcluded: z.string().max(3000).nullable().optional(),
  preparationOverride: z.string().max(4000).nullable().optional(),
  settings: docSettingsSchema,
  areas: z.array(docAreaSchema).max(500),
  lines: z.array(docLineSchema).max(3000),
  costItems: z.array(docCostItemSchema).max(500),
});

export type EstimateDoc = z.input<typeof estimateDocSchema>;
export type DocArea = EstimateDoc["areas"][number];
export type DocLine = EstimateDoc["lines"][number];
export type DocCostItem = EstimateDoc["costItems"][number];

/** Quantity actually used for a line: derived from room dimensions unless manual. */
export function resolvedQuantity(line: DocLine, area: DocArea | undefined): string {
  if (line.quantitySource === "manual" || !area) return line.quantity || "0";
  const q = quantityFromDimensions(line.quantitySource as DimensionSource, area);
  return q && q.gt(0) ? q.toString() : line.quantity || "0";
}

export function docToEngine(doc: EstimateDoc): { lines: LineInput[]; costItems: CostItemInput[]; settings: EstimateSettings } {
  const areas = new Map(doc.areas.map((a) => [a.id, a]));
  return {
    settings: doc.settings,
    lines: doc.lines.map((l) => ({
      id: l.id,
      description: l.description,
      rate: l.rateSnapshot as RateSnapshot,
      quantity: resolvedQuantity(l, l.areaId ? areas.get(l.areaId) : undefined),
      coats: l.coats,
      multipliers: { prep: l.prepFactor, difficulty: l.difficultyFactor, condition: l.conditionFactor, access: l.accessFactor },
      overrideHours: l.overrideHours,
      overridePrice: l.overridePrice,
      isOptional: l.isOptional,
      optionSelected: l.optionSelected,
    })),
    costItems: doc.costItems.map((c) => ({ ...c })),
  };
}

export function calculateDoc(doc: EstimateDoc): EstimateResult {
  const { lines, costItems, settings } = docToEngine(doc);
  return calculateEstimate(lines, costItems, settings);
}

/** Totals as plain strings for storage (revisions, cached columns). */
export function totalsToStrings(r: EstimateResult): Record<string, string> {
  return Object.fromEntries(Object.entries(r.totals).map(([k, v]) => [k, v.toFixed(k === "grossMargin" || k === "markup" ? 4 : 2)]));
}

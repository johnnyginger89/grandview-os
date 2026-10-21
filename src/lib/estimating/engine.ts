/**
 * Grandview OS production-rate estimating engine.
 *
 * Pure functions only: no database, no I/O. Every number that reaches a
 * customer or a job budget is produced here, so this file is covered by
 * engine.test.ts and must stay deterministic.
 *
 * Model:
 *   hours    = quantity ÷ production rate × coat factor × multipliers
 *   labour   = hours × labour cost rate
 *   material = quantity × coats ÷ coverage × (1 + waste) × price per gallon
 *   cost     = labour + material + other per-unit costs
 *   price    = cost ÷ (1 − target margin)            (target-margin pricing)
 *           or hours × billing rate + marked-up materials (billing-rate pricing)
 *
 * Margin and markup are always reported separately:
 *   margin = profit ÷ price      markup = profit ÷ cost
 */
import { Decimal, cents, d, margin, markup, type DecimalInput } from "@/lib/money";

export type RateUnit = "sqft" | "lnft" | "each" | "hour";
export type RateBasis = "units_per_hour" | "hours_per_unit";
export type PricingMethod = "target_margin" | "billing_rate";
export type CostItemKind = "subcontractor" | "equipment" | "material" | "other";

export const UNIT_LABELS: Record<RateUnit, string> = {
  sqft: "sq ft",
  lnft: "lin ft",
  each: "each",
  hour: "hours",
};

export interface MaterialSnapshot {
  productId?: string | null;
  productName: string;
  /** Units (sq ft, lin ft or items) covered per gallon, per coat. */
  coverage: string;
  pricePerGallon: string;
  containerGallons?: string | null;
}

/**
 * Everything the engine needs to know about a production rate. Copied onto
 * each line item when it is added, so later edits to the master rate library
 * never change an existing estimate.
 */
export interface RateSnapshot {
  rateId?: string | null;
  rateVersion?: number | null;
  name: string;
  unit: RateUnit;
  basis: RateBasis;
  /** Units per hour, or hours per unit, depending on `basis`. */
  productionRate: string;
  /** Time for each coat after the first, as a fraction of the first coat. */
  additionalCoatFactor: string;
  defaultCoats: number;
  laborCostPerHour?: string | null;
  billingRatePerHour?: string | null;
  material?: MaterialSnapshot | null;
  materialWastePct: string;
  otherCostPerUnit: string;
  /** Display-only fields for the proposal. Ignored by the engine. */
  category?: string | null;
  customerLabel?: string | null;
  proposalGroup?: string | null;
  /** Display only: the paint was picked by hand on the estimate. */
  materialOverridden?: boolean;
}

export interface LineMultipliers {
  prep: string;
  difficulty: string;
  condition: string;
  access: string;
}

export interface LineInput {
  id: string;
  description?: string;
  rate: RateSnapshot;
  quantity: DecimalInput;
  coats: number;
  multipliers?: Partial<LineMultipliers>;
  overrideHours?: DecimalInput;
  overridePrice?: DecimalInput;
  isOptional?: boolean;
  optionSelected?: boolean;
}

export interface CostItemInput {
  id: string;
  kind: CostItemKind;
  description: string;
  cost: DecimalInput;
  /** Overrides the estimate's pricing for this item, e.g. 0.15 = 15 % markup. */
  markupPct?: DecimalInput;
  overridePrice?: DecimalInput;
  isOptional?: boolean;
  optionSelected?: boolean;
}

export interface EstimateSettings {
  pricingMethod: PricingMethod;
  laborCostPerHour: DecimalInput;
  billingRatePerHour: DecimalInput;
  targetMargin: DecimalInput;
  /** Markup on materials and other costs under billing-rate pricing. */
  materialMarkupPct: DecimalInput;
  minimumJobPrice: DecimalInput;
  gstRate: DecimalInput;
  depositPct: DecimalInput;
  discount?: DecimalInput;
  priceOverride?: DecimalInput;
}

export interface LineResult {
  id: string;
  calculatedHours: Decimal;
  hours: Decimal;
  hoursOverridden: boolean;
  laborRate: Decimal;
  laborCost: Decimal;
  gallons: Decimal;
  materialCost: Decimal;
  otherCost: Decimal;
  cost: Decimal;
  calculatedPrice: Decimal;
  price: Decimal;
  priceOverridden: boolean;
  margin: Decimal;
  included: boolean;
}

export interface CostItemResult {
  id: string;
  kind: CostItemKind;
  cost: Decimal;
  price: Decimal;
  included: boolean;
}

export interface MaterialSummaryRow {
  productName: string;
  gallons: Decimal;
  containers: number | null;
  containerGallons: Decimal | null;
  cost: Decimal;
}

export interface EstimateTotals {
  hours: Decimal;
  laborCost: Decimal;
  materialCost: Decimal;
  otherCost: Decimal;
  subcontractorCost: Decimal;
  equipmentCost: Decimal;
  totalCost: Decimal;
  /** Sum of included line and cost-item prices, before minimum/discount/override. */
  subtotal: Decimal;
  minimumAdjustment: Decimal;
  discount: Decimal;
  overrideAdjustment: Decimal;
  /** Contract price before GST. */
  price: Decimal;
  gst: Decimal;
  total: Decimal;
  grossProfit: Decimal;
  grossMargin: Decimal;
  markup: Decimal;
  deposit: Decimal;
  /** Price of optional items that are offered but not selected. */
  unselectedOptionsPrice: Decimal;
}

export interface EstimateResult {
  lines: LineResult[];
  costItems: CostItemResult[];
  materials: MaterialSummaryRow[];
  totals: EstimateTotals;
}

const ONE = new Decimal(1);

function factor(v: string | undefined): Decimal {
  if (v === undefined || v === null || v === "") return ONE;
  return d(v);
}

function hasValue(v: DecimalInput): v is Decimal.Value {
  return v !== null && v !== undefined && v !== "";
}

export function isIncluded(item: { isOptional?: boolean; optionSelected?: boolean }): boolean {
  return !item.isOptional || !!item.optionSelected;
}

export function coatFactor(coats: number, additionalCoatFactor: string): Decimal {
  if (coats <= 0) return new Decimal(0);
  return ONE.plus(new Decimal(coats - 1).times(factor(additionalCoatFactor)));
}

export function combinedMultiplier(m?: Partial<LineMultipliers>): Decimal {
  return factor(m?.prep).times(factor(m?.difficulty)).times(factor(m?.condition)).times(factor(m?.access));
}

/** Labour hours for one coat-adjusted line, before multipliers. */
export function baseHours(rate: RateSnapshot, quantity: DecimalInput, coats: number): Decimal {
  const qty = d(quantity);
  if (rate.unit === "hour") return qty;
  const prod = d(rate.productionRate);
  const cf = coatFactor(coats, rate.additionalCoatFactor);
  if (rate.basis === "hours_per_unit") return qty.times(prod).times(cf);
  if (prod.lte(0)) throw new Error(`Production rate for "${rate.name}" must be greater than zero`);
  return qty.div(prod).times(cf);
}

export function materialGallons(rate: RateSnapshot, quantity: DecimalInput, coats: number): Decimal {
  const m = rate.material;
  if (!m) return new Decimal(0);
  const coverage = d(m.coverage);
  if (coverage.lte(0)) return new Decimal(0);
  return d(quantity).times(coats).div(coverage).times(ONE.plus(d(rate.materialWastePct)));
}

function priceFromCost(cost: Decimal, settings: EstimateSettings): Decimal {
  if (settings.pricingMethod === "target_margin") {
    const m = d(settings.targetMargin);
    if (m.gte(1)) throw new Error("Target margin must be below 100%");
    return cost.div(ONE.minus(m));
  }
  return cost.times(ONE.plus(d(settings.materialMarkupPct)));
}

export function calculateLine(line: LineInput, settings: EstimateSettings): LineResult {
  const { rate } = line;
  const calculatedHours = baseHours(rate, line.quantity, line.coats).times(combinedMultiplier(line.multipliers));
  const hoursOverridden = hasValue(line.overrideHours);
  const hours = hoursOverridden ? d(line.overrideHours) : calculatedHours;

  const laborRate = hasValue(rate.laborCostPerHour) ? d(rate.laborCostPerHour) : d(settings.laborCostPerHour);
  const laborCost = cents(hours.times(laborRate));
  const gallons = materialGallons(rate, line.quantity, line.coats);
  const materialCost = cents(gallons.times(d(rate.material?.pricePerGallon)));
  const otherCost = cents(d(line.quantity).times(d(rate.otherCostPerUnit)));
  const cost = laborCost.plus(materialCost).plus(otherCost);

  let calculatedPrice: Decimal;
  if (settings.pricingMethod === "target_margin") {
    calculatedPrice = priceFromCost(cost, settings);
  } else {
    const billRate = hasValue(rate.billingRatePerHour) ? d(rate.billingRatePerHour) : d(settings.billingRatePerHour);
    calculatedPrice = hours
      .times(billRate)
      .plus(materialCost.plus(otherCost).times(ONE.plus(d(settings.materialMarkupPct))));
  }
  calculatedPrice = cents(calculatedPrice);

  const priceOverridden = hasValue(line.overridePrice);
  const price = priceOverridden ? cents(line.overridePrice) : calculatedPrice;

  return {
    id: line.id,
    calculatedHours,
    hours,
    hoursOverridden,
    laborRate,
    laborCost,
    gallons,
    materialCost,
    otherCost,
    cost,
    calculatedPrice,
    price,
    priceOverridden,
    margin: margin(price, cost),
    included: isIncluded(line),
  };
}

export function calculateCostItem(item: CostItemInput, settings: EstimateSettings): CostItemResult {
  const cost = cents(item.cost);
  let price: Decimal;
  if (hasValue(item.overridePrice)) price = cents(item.overridePrice);
  else if (hasValue(item.markupPct)) price = cents(cost.times(ONE.plus(d(item.markupPct))));
  else price = cents(priceFromCost(cost, settings));
  return { id: item.id, kind: item.kind, cost, price, included: isIncluded(item) };
}

export function summarizeMaterials(lines: LineInput[], results: LineResult[]): MaterialSummaryRow[] {
  const rows = new Map<string, MaterialSummaryRow>();
  lines.forEach((line, i) => {
    const r = results[i];
    const m = line.rate.material;
    if (!m || !r.included || r.gallons.isZero()) return;
    const key = m.productId ?? m.productName;
    const existing = rows.get(key);
    const containerGallons = hasValue(m.containerGallons) && d(m.containerGallons).gt(0) ? d(m.containerGallons) : null;
    if (existing) {
      existing.gallons = existing.gallons.plus(r.gallons);
      existing.cost = existing.cost.plus(r.materialCost);
    } else {
      rows.set(key, { productName: m.productName, gallons: r.gallons, containers: null, containerGallons, cost: r.materialCost });
    }
  });
  for (const row of rows.values()) {
    if (row.containerGallons) row.containers = row.gallons.div(row.containerGallons).ceil().toNumber();
  }
  return [...rows.values()];
}

export function calculateEstimate(
  lines: LineInput[],
  costItems: CostItemInput[],
  settings: EstimateSettings,
): EstimateResult {
  const lineResults = lines.map((l) => calculateLine(l, settings));
  const costResults = costItems.map((c) => calculateCostItem(c, settings));

  const zero = () => new Decimal(0);
  let hours = zero(), laborCost = zero(), materialCost = zero(), otherCost = zero();
  let subcontractorCost = zero(), equipmentCost = zero(), subtotal = zero(), unselectedOptionsPrice = zero();

  for (const r of lineResults) {
    if (!r.included) {
      unselectedOptionsPrice = unselectedOptionsPrice.plus(r.price);
      continue;
    }
    hours = hours.plus(r.hours);
    laborCost = laborCost.plus(r.laborCost);
    materialCost = materialCost.plus(r.materialCost);
    otherCost = otherCost.plus(r.otherCost);
    subtotal = subtotal.plus(r.price);
  }
  for (const r of costResults) {
    if (!r.included) {
      unselectedOptionsPrice = unselectedOptionsPrice.plus(r.price);
      continue;
    }
    if (r.kind === "subcontractor") subcontractorCost = subcontractorCost.plus(r.cost);
    else if (r.kind === "equipment") equipmentCost = equipmentCost.plus(r.cost);
    else if (r.kind === "material") materialCost = materialCost.plus(r.cost);
    else otherCost = otherCost.plus(r.cost);
    subtotal = subtotal.plus(r.price);
  }

  const totalCost = laborCost.plus(materialCost).plus(otherCost).plus(subcontractorCost).plus(equipmentCost);
  const minimum = d(settings.minimumJobPrice);
  const minimumAdjustment = subtotal.gt(0) && subtotal.lt(minimum) ? minimum.minus(subtotal) : zero();
  const discount = cents(settings.discount);
  let price = subtotal.plus(minimumAdjustment).minus(discount);
  let overrideAdjustment = zero();
  if (hasValue(settings.priceOverride)) {
    const override = cents(settings.priceOverride);
    overrideAdjustment = override.minus(price);
    price = override;
  }
  if (price.lt(0)) price = zero();

  const gst = cents(price.times(d(settings.gstRate)));
  const total = price.plus(gst);
  const grossProfit = price.minus(totalCost);

  return {
    lines: lineResults,
    costItems: costResults,
    materials: summarizeMaterials(lines, lineResults),
    totals: {
      hours,
      laborCost,
      materialCost,
      otherCost,
      subcontractorCost,
      equipmentCost,
      totalCost,
      subtotal,
      minimumAdjustment,
      discount,
      overrideAdjustment,
      price,
      gst,
      total,
      grossProfit,
      grossMargin: margin(price, totalCost),
      markup: markup(price, totalCost),
      deposit: cents(total.times(d(settings.depositPct))),
      unselectedOptionsPrice,
    },
  };
}

/** Room / area geometry used to auto-fill quantities from dimensions. */
export interface AreaDimensions {
  length?: DecimalInput;
  width?: DecimalInput;
  height?: DecimalInput;
}

export type DimensionSource = "manual" | "walls" | "ceiling" | "floor" | "perimeter";

export function areaQuantities(dim: AreaDimensions) {
  const l = d(dim.length), w = d(dim.width), h = d(dim.height);
  const perimeter = l.plus(w).times(2);
  return {
    walls: perimeter.times(h),
    ceiling: l.times(w),
    floor: l.times(w),
    perimeter,
  };
}

export function quantityFromDimensions(source: DimensionSource, dim: AreaDimensions): Decimal | null {
  if (source === "manual") return null;
  return areaQuantities(dim)[source];
}

/**
 * Approximate crew duration. 120 h with 3 painters at 8 h/day = 5 days.
 * Rounded up to the nearest half day.
 */
export function crewDurationDays(hours: DecimalInput, crewSize: number, hoursPerDay: DecimalInput = 8): Decimal {
  const capacity = d(hoursPerDay).times(crewSize);
  if (capacity.lte(0)) return new Decimal(0);
  return d(hours).div(capacity).times(2).ceil().div(2);
}

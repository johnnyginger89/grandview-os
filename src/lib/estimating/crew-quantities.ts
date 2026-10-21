/**
 * What a crew needs from the signed estimate besides the scope: labour hours and how much
 * paint to buy. Pure, and built from the engine's own functions so a work order always
 * agrees with the estimate it came from:
 *   hours   = the engine's line hours (production rate, coats, multipliers; an override wins)
 *   gallons = the engine's material gallons (quantity × coats ÷ coverage, plus waste)
 * Nothing here reads or returns money: crews see hours and paint, never prices (owner's
 * decision, Oct 2026).
 */
import { d, Decimal, type DecimalInput } from "@/lib/money";
import { docToEngine, type EstimateDoc } from "./document";
import { baseHours, combinedMultiplier, isIncluded, materialGallons, type LineInput } from "./engine";

const ZERO = new Decimal(0);

const hasValue = (v: unknown) => v !== null && v !== undefined && v !== "";

/** A positive number from the document, or null (old or hand-edited snapshots can hold anything). */
function positive(v: DecimalInput): Decimal | null {
  try {
    const n = d(v);
    return n.isFinite() && n.gt(0) ? n : null;
  } catch {
    return null;
  }
}

/** Labour hours for one line as the engine counts them (an override wins); null when they can't be worked out. */
export function lineHours(line: LineInput): Decimal | null {
  try {
    const h = hasValue(line.overrideHours) ? d(line.overrideHours) : baseHours(line.rate, line.quantity, line.coats).times(combinedMultiplier(line.multipliers));
    return h.isFinite() && !h.isNegative() ? h : null;
  } catch {
    return null;
  }
}

export interface PaintNeed {
  key: string;
  product: string;
  colour: string | null;
  sheen: string | null;
  /** Gallons worked out (waste included) from the lines that have a coverage and a quantity. */
  gallons: Decimal;
  /** Lines (ids) whose product has no coverage on file, so no amount is guessed for them. */
  noCoverage: string[];
  /** Lines (ids) with nothing measured (quantity 0), so no amount for them either. */
  noQuantity: string[];
}

export interface CrewQuantities {
  /** Labour hours per included line; lines whose hours can't be worked out are left out. */
  lineHours: Map<string, Decimal>;
  /** Labour hours of every included line: the estimate's own total. */
  jobHours: Decimal;
  /** Paint by product, colour and sheen, in the order the estimate first uses each. */
  paint: PaintNeed[];
}

const clean = (s: string | null | undefined) => s?.trim() || null;
const keyPart = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ");

/** Lines share a paint when product, colour and sheen match (case and spacing ignored). */
export function paintKey(material: { productId?: string | null; productName: string }, colour: string | null | undefined, sheen: string | null | undefined): string {
  return [clean(material.productId) ?? keyPart(clean(material.productName)), keyPart(clean(colour)), keyPart(clean(sheen))].join("|");
}

/**
 * Hours and paint for what the customer is getting: required lines and selected options.
 * Cost items (subcontractors, equipment) are never looked at.
 */
export function crewQuantities(doc: EstimateDoc): CrewQuantities {
  const engine = docToEngine(doc);
  const hours = new Map<string, Decimal>();
  let jobHours = ZERO;
  const groups = new Map<string, PaintNeed>();

  doc.lines.forEach((docLine, i) => {
    const line = engine.lines[i];
    if (!isIncluded(line)) return;
    const h = lineHours(line);
    if (h) {
      hours.set(line.id, h);
      jobHours = jobHours.plus(h);
    }

    const material = line.rate.material;
    const product = clean(material?.productName);
    if (!material || !product || !(line.coats > 0)) return;
    const colour = clean(docLine.colour);
    const sheen = clean(docLine.sheen);
    const key = paintKey(material, colour, sheen);
    let need = groups.get(key);
    if (!need) groups.set(key, (need = { key, product, colour, sheen, gallons: ZERO, noCoverage: [], noQuantity: [] }));

    if (!positive(material.coverage)) need.noCoverage.push(line.id);
    else if (!positive(line.quantity)) need.noQuantity.push(line.id);
    else {
      try {
        need.gallons = need.gallons.plus(materialGallons(line.rate, line.quantity, line.coats));
      } catch {
        need.noCoverage.push(line.id);
      }
    }
  });

  return { lineHours: hours, jobHours, paint: [...groups.values()] };
}

/** "3.5", "12", "0.1": one decimal, and never 0 for work that takes some time. */
export function hoursLabel(hours: Decimal): string {
  if (!hours.gt(0)) return "0";
  const rounded = hours.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  return (rounded.gt(0) ? rounded : new Decimal("0.1")).toNumber().toLocaleString("en-CA", { maximumFractionDigits: 1 });
}

/**
 * What to buy for an amount of paint: round up to the quart, then a single extra quart
 * is bought as a quart, and two or three extra quarts as another gallon (a gallon costs
 * about the same as two quarts). 2.2 gal → 2 gal + 1 qt; 2.3 gal → 3 gal; 0.2 gal → 1 qt.
 */
export function paintToBuy(gallons: Decimal): { gallons: number; quarts: number } {
  if (!gallons.gt(0)) return { gallons: 0, quarts: 0 };
  // Two decimals first, so arithmetic dust (1.0000001 gal) doesn't add a quart.
  const quarts = Math.max(1, gallons.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).times(4).ceil().toNumber());
  const whole = Math.floor(quarts / 4);
  const rest = quarts % 4;
  if (rest === 0) return { gallons: whole, quarts: 0 };
  if (rest === 1) return { gallons: whole, quarts: 1 };
  return { gallons: whole + 1, quarts: 0 };
}

/** "3 gal", "2 gal + 1 qt", "1 qt". */
export function paintToBuyLabel(buy: { gallons: number; quarts: number }): string {
  const parts = [buy.gallons ? `${buy.gallons} gal` : null, buy.quarts ? `${buy.quarts} qt` : null].filter((p): p is string => !!p);
  return parts.join(" + ") || "0 gal";
}

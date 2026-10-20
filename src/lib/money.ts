import Decimal from "decimal.js";

// All financial math goes through Decimal. Never use JS floats for money.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type DecimalInput = Decimal.Value | null | undefined;

export function d(value: DecimalInput): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(value);
}

/** Round to cents (half-up, the convention used on Canadian invoices). */
export function cents(value: DecimalInput): Decimal {
  return d(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** String form suitable for a Postgres numeric column. */
export function toDb(value: DecimalInput, places = 2): string {
  return d(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export function formatCAD(value: DecimalInput): string {
  return cad.format(cents(value).toNumber());
}

export function formatPct(value: DecimalInput, places = 1): string {
  return `${d(value).times(100).toDecimalPlaces(places).toFixed(places)}%`;
}

export function formatNum(value: DecimalInput, places = 1): string {
  return d(value).toDecimalPlaces(places).toNumber().toLocaleString("en-CA", {
    maximumFractionDigits: places,
  });
}

/** Gross margin = profit / price. Returns 0 when price is 0. */
export function margin(price: DecimalInput, cost: DecimalInput): Decimal {
  const p = d(price);
  if (p.isZero()) return new Decimal(0);
  return p.minus(d(cost)).div(p);
}

/** Markup = profit / cost. Returns 0 when cost is 0. */
export function markup(price: DecimalInput, cost: DecimalInput): Decimal {
  const c = d(cost);
  if (c.isZero()) return new Decimal(0);
  return d(price).minus(c).div(c);
}

/** Price required to hit a target gross margin on a given cost. */
export function priceForMargin(cost: DecimalInput, targetMargin: DecimalInput): Decimal {
  const m = d(targetMargin);
  if (m.gte(1)) throw new Error("Target margin must be below 100%");
  return d(cost).div(new Decimal(1).minus(m));
}

export function marginToMarkup(m: DecimalInput): Decimal {
  const v = d(m);
  if (v.gte(1)) throw new Error("Margin must be below 100%");
  return v.div(new Decimal(1).minus(v));
}

export function markupToMargin(mu: DecimalInput): Decimal {
  const v = d(mu);
  return v.div(new Decimal(1).plus(v));
}

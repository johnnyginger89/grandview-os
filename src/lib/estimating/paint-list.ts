/**
 * The paint-store shopping list for an estimate: gallons by product, colour and sheen, what
 * to buy, and which rooms use it. Display only: it groups the engine's own gallons (via
 * crewQuantities, so the work order shows the same amounts) and never changes a price.
 */
import { Decimal } from "@/lib/money";
import { crewQuantities, paintKey, paintToBuy, paintToBuyLabel, type PaintNeed } from "./crew-quantities";
import type { EstimateDoc } from "./document";

export interface PaintListRow {
  key: string;
  product: string;
  colour: string | null;
  sheen: string | null;
  gallons: Decimal;
  /** "5 gal", "2 gal + 1 qt"; null when nothing could be worked out yet. */
  buy: string | null;
  /** Room names, in estimate order. */
  rooms: string[];
  /** Lines with nothing measured yet, or a product without coverage on file. */
  unmeasured: number;
}

export interface PaintList {
  rows: PaintListRow[];
  /** Extra paint if the customer adds every optional upgrade not chosen yet. */
  ifOptionsAdded: PaintListRow[];
}

function rowsFor(doc: EstimateDoc, needs: PaintNeed[]): PaintListRow[] {
  const areaName = new Map(doc.areas.map((a) => [a.id, a.name]));
  const rooms = new Map<string, string[]>();
  for (const l of doc.lines) {
    const m = l.rateSnapshot.material;
    if (!m) continue;
    const key = paintKey(m, l.colour, l.sheen);
    const name = l.areaId ? areaName.get(l.areaId) : null;
    if (!name) continue;
    const list = rooms.get(key) ?? [];
    if (!list.includes(name)) list.push(name);
    rooms.set(key, list);
  }
  return needs.map((n) => ({
    key: n.key,
    product: n.product,
    colour: n.colour,
    sheen: n.sheen,
    gallons: n.gallons,
    buy: n.gallons.gt(0) ? paintToBuyLabel(paintToBuy(n.gallons)) : null,
    rooms: rooms.get(n.key) ?? [],
    unmeasured: n.noCoverage.length + n.noQuantity.length,
  }));
}

export function paintList(doc: EstimateDoc): PaintList {
  const base = crewQuantities(doc);
  const rows = rowsFor(doc, base.paint);

  const unchosen = doc.lines.filter((l) => l.isOptional && !l.optionSelected);
  if (!unchosen.length) return { rows, ifOptionsAdded: [] };
  const withAll = crewQuantities({ ...doc, lines: doc.lines.map((l) => (l.isOptional ? { ...l, optionSelected: true } : l)) });
  const had = new Map(base.paint.map((p) => [p.key, p.gallons]));
  const extra = withAll.paint
    .map((p) => ({ ...p, gallons: p.gallons.minus(had.get(p.key) ?? 0), noCoverage: [], noQuantity: [] }))
    .filter((p) => p.gallons.gt(0));
  return { rows, ifOptionsAdded: rowsFor(doc, extra) };
}

/** Plain text for the clipboard, ready to text to the paint store. */
export function paintListText(list: PaintList): string {
  const line = (r: PaintListRow) => `${r.product}${r.colour ? `, ${r.colour}` : ", colour not chosen"}${r.sheen ? ` (${r.sheen})` : ""}: ${r.buy ?? "not measured yet"}`;
  return [...list.rows.map(line), ...(list.ifOptionsAdded.length ? ["", "If the customer adds the options:", ...list.ifOptionsAdded.map(line)] : [])].join("\n");
}

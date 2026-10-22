import type { EstimateDoc } from "./document";
import type { EstimateResult } from "./engine";

export interface UnpricedSurface {
  id: string;
  /** "Living room – Walls", as the customer would read it. */
  label: string;
}

/**
 * Surfaces the customer would be promised for $0: part of the job (not an upgrade they haven't
 * picked) and priced at nothing, usually because they haven't been measured yet. They'd show on
 * the proposal and the crew's work order as work included.
 */
export function unpricedSurfaces(doc: EstimateDoc, result: EstimateResult): UnpricedSurface[] {
  const area = new Map(doc.areas.map((a) => [a.id, a.name]));
  const priced = new Map(result.lines.map((l) => [l.id, l]));
  return doc.lines.flatMap((l) => {
    const r = priced.get(l.id);
    if (!r?.included || !r.price.isZero()) return [];
    const name = l.customerDescription?.trim() || l.rateSnapshot.customerLabel?.trim() || l.description?.trim() || l.rateSnapshot.name;
    return [{ id: l.id, label: [l.areaId ? area.get(l.areaId) : null, name].filter(Boolean).join(" – ") }];
  });
}

/** "Living room – Walls and 2 more" for a short message. */
export function unpricedSummary(surfaces: UnpricedSurface[]): string {
  if (!surfaces.length) return "";
  const [first, ...rest] = surfaces;
  return rest.length ? `${first.label} and ${rest.length} more` : first.label;
}

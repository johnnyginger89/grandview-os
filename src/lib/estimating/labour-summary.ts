/**
 * Where the hours go: by room and by kind of work, plus crew days. Display only, from the
 * same per-line hours the engine prices (lines in the price only).
 */
import { Decimal } from "@/lib/money";
import { crewQuantities } from "./crew-quantities";
import type { EstimateDoc } from "./document";
import { crewDurationDays } from "./engine";

export interface LabourSummary {
  hours: Decimal;
  byRoom: { name: string; hours: Decimal }[];
  byType: { name: string; hours: Decimal }[];
  /** Lines whose hours were typed by hand. */
  setByHand: number;
  days: (crew: number, hoursPerDay: string) => Decimal;
}

function add(map: Map<string, Decimal>, key: string, h: Decimal) {
  map.set(key, (map.get(key) ?? new Decimal(0)).plus(h));
}

const sorted = (m: Map<string, Decimal>) => [...m.entries()].map(([name, hours]) => ({ name, hours })).sort((a, b) => b.hours.comparedTo(a.hours));

export function labourSummary(doc: EstimateDoc): LabourSummary {
  const q = crewQuantities(doc);
  const areaName = new Map(doc.areas.map((a) => [a.id, a.name]));
  const byRoom = new Map<string, Decimal>();
  const byType = new Map<string, Decimal>();
  let setByHand = 0;
  for (const l of doc.lines) {
    const h = q.lineHours.get(l.id);
    if (!h || !h.gt(0)) continue;
    add(byRoom, (l.areaId && areaName.get(l.areaId)) || "General", h);
    add(byType, l.rateSnapshot.proposalGroup || l.rateSnapshot.category || l.rateSnapshot.name, h);
    if (l.overrideHours != null && l.overrideHours !== "") setByHand++;
  }
  return { hours: q.jobHours, byRoom: sorted(byRoom), byType: sorted(byType), setByHand, days: (crew, hpd) => crewDurationDays(q.jobHours, crew, hpd) };
}

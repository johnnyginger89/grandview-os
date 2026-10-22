import { describe, expect, it } from "vitest";
import { calculateDoc, type EstimateDoc } from "./document";
import type { RateSnapshot } from "./engine";
import { unpricedSummary, unpricedSurfaces } from "./unpriced";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROOM = uuid(1);
const snap = (name: string, customerLabel: string | null = null): RateSnapshot => ({
  rateId: uuid(500), rateVersion: 1, name, unit: "sqft", basis: "units_per_hour", productionRate: "150", additionalCoatFactor: "0.85", defaultCoats: 2,
  laborCostPerHour: "45", billingRatePerHour: "75", material: null, materialWastePct: "0.1", otherCostPerUnit: "0", category: "Interior", customerLabel, proposalGroup: null,
});
const line = (n: number, name: string, extra: Partial<EstimateDoc["lines"][number]> = {}): EstimateDoc["lines"][number] => ({
  id: uuid(n), areaId: ROOM, description: name, customerDescription: null, customerDetail: null, rateSnapshot: snap(name), quantity: "300", quantitySource: "manual",
  coats: 2, prepFactor: "1", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null, overrideHours: null, overridePrice: null,
  isOptional: false, optionSelected: false, ...extra,
});
const doc = (lines: EstimateDoc["lines"]): EstimateDoc => ({
  title: "[TEST DATA] Repaint", jobType: "interior", contractType: "fixed_price", internalNotes: null, customerNotes: null, poNumber: null, areasExcluded: null, preparationOverride: null,
  settings: { pricingMethod: "billing_rate", laborCostPerHour: "45", billingRatePerHour: "75", targetMargin: "0.4", materialMarkupPct: "0.15", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.3", discount: null, priceOverride: null },
  areas: [{ id: ROOM, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null, notes: null, customerDescription: null }],
  lines,
  costItems: [],
});
const find = (d: EstimateDoc) => unpricedSurfaces(d, calculateDoc(d));

describe("unpricedSurfaces", () => {
  it("finds surfaces in the job priced at $0, named as the customer would read them", () => {
    const d = doc([
      line(2, "Walls – roll & cut"),
      line(3, "Trim – brush", { quantity: "0" }),
      { ...line(4, "Ceilings", { quantity: "0" }), rateSnapshot: snap("Ceilings", "Ceilings, flat white") },
      line(5, "Doors", { quantity: "0", customerDescription: "Two closet doors" }),
    ]);
    expect(find(d).map((s) => s.label)).toEqual(["Living room – Trim – brush", "Living room – Ceilings, flat white", "Living room – Two closet doors"]);
  });

  it("leaves out measured surfaces, ones with a price typed in, and upgrades the customer hasn't picked", () => {
    const d = doc([
      line(2, "Walls – roll & cut"),
      line(3, "Trim – brush", { quantity: "0", overridePrice: "250" }),
      line(4, "Accent wall", { quantity: "0", isOptional: true, optionSelected: false }),
    ]);
    expect(find(d)).toEqual([]);
    // A picked upgrade is part of the job.
    const picked = doc([line(4, "Accent wall", { quantity: "0", isOptional: true, optionSelected: true })]);
    expect(find(picked).map((s) => s.id)).toEqual([uuid(4)]);
  });

  it("sums up for a short message", () => {
    expect(unpricedSummary([])).toBe("");
    expect(unpricedSummary([{ id: "a", label: "Kitchen – Walls" }])).toBe("Kitchen – Walls");
    expect(unpricedSummary([{ id: "a", label: "Kitchen – Walls" }, { id: "b", label: "Kitchen – Trim" }, { id: "c", label: "Hall – Doors" }])).toBe("Kitchen – Walls and 2 more");
  });
});

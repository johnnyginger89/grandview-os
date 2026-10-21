import { describe, expect, it } from "vitest";
import type { EstimateDoc } from "./document";
import type { RateSnapshot } from "./engine";
import { labourSummary } from "./labour-summary";
import { paintList, paintListText } from "./paint-list";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LIVING = uuid(900);
const HALL = uuid(901);

function rate(name: string, opts: Partial<RateSnapshot> = {}): RateSnapshot {
  return {
    name, unit: "sqft", basis: "units_per_hour", productionRate: "175", additionalCoatFactor: "0.85", defaultCoats: 2,
    material: { productId: uuid(600), productName: "Duration Matte", coverage: "350", pricePerGallon: "70", containerGallons: "1" },
    materialWastePct: "0.10", otherCostPerUnit: "0", category: "Interior", proposalGroup: "Walls", ...opts,
  };
}
const WALLS = rate("Walls");
const CEILING = rate("Ceiling", { proposalGroup: "Ceilings", material: { productId: uuid(601), productName: "Ceiling Flat", coverage: "400", pricePerGallon: "55", containerGallons: "1" } });
const DOOR = rate("Door", { unit: "each", basis: "hours_per_unit", productionRate: "0.5", proposalGroup: null, category: "Interior", material: null });

type DocLine = EstimateDoc["lines"][number];
const line = (n: number, area: string | null, r: RateSnapshot, extra: Partial<DocLine> = {}): DocLine => ({
  id: uuid(n), areaId: area, description: r.name, rateSnapshot: r, quantity: "350", quantitySource: "manual", coats: 2,
  prepFactor: "1", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null,
  overrideHours: null, overridePrice: null, isOptional: false, optionSelected: false, ...extra,
});

const doc: EstimateDoc = {
  title: "Repaint", jobType: "interior", contractType: "fixed_price",
  settings: { pricingMethod: "billing_rate", laborCostPerHour: "45", billingRatePerHour: "75", targetMargin: "0.45", materialMarkupPct: "0.2", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.2" },
  areas: [
    { id: LIVING, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null },
    { id: HALL, parentId: null, name: "Hall", kind: "room", length: null, width: null, height: null },
  ],
  lines: [
    line(1, LIVING, WALLS, { colour: "SW 7008 Alabaster" }),
    line(2, HALL, WALLS, { colour: " sw 7008  alabaster " }),
    line(3, LIVING, CEILING, { quantity: "0" }),
    line(4, LIVING, CEILING, { quantity: "400", isOptional: true }),
    line(5, HALL, DOOR, { quantity: "2", overrideHours: "3" }),
  ],
  costItems: [],
};

describe("paintList", () => {
  const list = paintList(doc);

  it("groups by product and colour, ignoring case and spaces, and lists the rooms", () => {
    const walls = list.rows.find((r) => r.product === "Duration Matte")!;
    // 2 × 350 sq ft × 2 coats ÷ 350 sq ft/gal × 1.10 waste = 4.4 gal.
    expect(walls.gallons.toFixed(2)).toBe("4.40");
    expect(walls.colour).toBe("SW 7008 Alabaster");
    expect(walls.buy).toBe("5 gal");
    expect(walls.rooms).toEqual(["Living room", "Hall"]);
  });

  it("flags paint with nothing measured instead of guessing", () => {
    const ceiling = list.rows.find((r) => r.product === "Ceiling Flat")!;
    expect(ceiling).toMatchObject({ buy: null, unmeasured: 1, colour: null });
  });

  it("shows options not chosen as extra paint only", () => {
    expect(list.ifOptionsAdded).toHaveLength(1);
    // 400 × 2 ÷ 400 × 1.10 = 2.2 gal.
    expect(list.ifOptionsAdded[0]).toMatchObject({ product: "Ceiling Flat", buy: "2 gal + 1 qt" });
    expect(list.ifOptionsAdded[0].gallons.toFixed(1)).toBe("2.2");
  });

  it("copies as plain text for the paint store, with no prices", () => {
    const text = paintListText(list);
    expect(text).toContain("Duration Matte, SW 7008 Alabaster: 5 gal");
    expect(text).toContain("Ceiling Flat, colour not chosen: not measured yet");
    expect(text).toContain("If the customer adds the options:");
    expect(text).not.toMatch(/\$/);
  });
});

describe("labourSummary", () => {
  it("adds hours by room and by kind of work, from lines in the price", () => {
    const s = labourSummary(doc);
    // Walls: 350 sq ft at 175/h = 2 h for the first coat, + 0.85 × 2 for the second = 3.7 h each.
    expect(s.byRoom.map((r) => [r.name, r.hours.toFixed(1)])).toEqual([["Hall", "6.7"], ["Living room", "3.7"]]);
    expect(s.byType.map((r) => [r.name, r.hours.toFixed(1)])).toEqual([["Walls", "7.4"], ["Interior", "3.0"]]);
    expect(s.hours.toFixed(1)).toBe("10.4");
    expect(s.setByHand).toBe(1);
    expect(s.days(2, "8").toString()).toBe("1");
  });
});

import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/money";
import { crewQuantities, hoursLabel, lineHours, paintToBuy, paintToBuyLabel } from "./crew-quantities";
import { calculateDoc, docToEngine, type EstimateDoc } from "./document";
import type { RateSnapshot } from "./engine";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROOM = uuid(900);

function rate(name: string, opts: Partial<RateSnapshot> = {}): RateSnapshot {
  return {
    name, unit: "sqft", basis: "units_per_hour", productionRate: "150", additionalCoatFactor: "0.85", defaultCoats: 2,
    laborCostPerHour: "45", billingRatePerHour: "75",
    material: { productId: uuid(600), productName: "SW Duration Matte", coverage: "350", pricePerGallon: "70", containerGallons: "1" },
    materialWastePct: "0.10", otherCostPerUnit: "0", category: "Interior", customerLabel: null, proposalGroup: null, ...opts,
  };
}

const WALLS = rate("Walls");
const CEILING = rate("Ceiling", { material: { productId: uuid(601), productName: "BM Ceiling Flat", coverage: "400", pricePerGallon: "55", containerGallons: "1" } });
const NO_COVERAGE = rate("Stain", { material: { productId: uuid(602), productName: "Cabot Stain", coverage: "0", pricePerGallon: "60", containerGallons: "1" } });
const DOORS = rate("Doors", { unit: "each", basis: "hours_per_unit", productionRate: "0.5", additionalCoatFactor: "0.75", material: null });
const REPAIR = rate("Repairs", { unit: "hour", material: null, category: "Repairs" });

type DocLine = EstimateDoc["lines"][number];
function line(n: number, r: RateSnapshot, extra: Partial<DocLine> = {}): DocLine {
  return {
    id: uuid(n), areaId: ROOM, description: r.name, rateSnapshot: r, quantity: "300", quantitySource: "manual", coats: 2,
    prepFactor: "1.15", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null,
    overrideHours: null, overridePrice: null, isOptional: false, optionSelected: false, ...extra,
  };
}

const doc: EstimateDoc = {
  title: "Repaint", jobType: "interior", contractType: "fixed_price",
  settings: { pricingMethod: "target_margin", laborCostPerHour: "45", billingRatePerHour: "75", targetMargin: "0.45", materialMarkupPct: "0.2", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.2" },
  areas: [{ id: ROOM, parentId: null, name: "Kitchen", kind: "room", length: "12", width: "10", height: "8" }],
  lines: [
    // Walls from the room size: 2 × (12 + 10) × 8 = 352 sq ft.
    line(1, WALLS, { quantitySource: "walls", quantity: "0", colour: " SW 7008 Alabaster ", sheen: "Eggshell" }),
    line(2, WALLS, { quantity: "100", colour: "sw 7008  alabaster", sheen: "eggshell" }),
    line(3, WALLS, { quantity: "50", colour: "SW 7008 Alabaster", sheen: "Satin" }),
    line(4, CEILING, { quantity: "120" }),
    line(5, CEILING, { quantity: "500", isOptional: true, optionSelected: false }),
    line(6, DOORS, { quantity: "4", overrideHours: "6.5" }),
    line(7, NO_COVERAGE, { quantity: "80" }),
    line(8, CEILING, { quantity: "0", areaId: null }),
    line(9, REPAIR, { quantity: "3", coats: 0 }),
  ],
  costItems: [{ id: uuid(700), kind: "subcontractor", description: "Lift", cost: "900", isOptional: false, optionSelected: false }],
};

describe("crewQuantities", () => {
  const q = crewQuantities(doc);
  const engine = calculateDoc(doc);

  it("gives every included line the engine's own hours, and the estimate's total", () => {
    const included = engine.lines.filter((l) => l.included);
    for (const l of included) expect(q.lineHours.get(l.id)?.toString(), l.id).toBe(l.hours.toString());
    expect(q.lineHours.has(uuid(5))).toBe(false);
    expect(q.jobHours.toString()).toBe(engine.totals.hours.toString());
  });

  it("uses the estimator's hours when they were typed over", () => {
    expect(q.lineHours.get(uuid(6))?.toString()).toBe("6.5");
    expect(lineHours(docToEngine(doc).lines[5])?.toString()).toBe("6.5");
  });

  it("groups paint by product, colour and sheen, ignoring case and spacing", () => {
    expect(q.paint.map((p) => [p.product, p.colour, p.sheen])).toEqual([
      ["SW Duration Matte", "SW 7008 Alabaster", "Eggshell"],
      ["SW Duration Matte", "SW 7008 Alabaster", "Satin"],
      ["BM Ceiling Flat", null, null],
      ["Cabot Stain", null, null],
    ]);
  });

  it("adds up the engine's gallons for each group, leaving out unchosen options", () => {
    const gallons = (ids: number[]) => engine.lines.filter((l) => ids.map(uuid).includes(l.id)).reduce((s, l) => s.plus(l.gallons), new Decimal(0));
    expect(q.paint[0].gallons.toString()).toBe(gallons([1, 2]).toString());
    // (352 + 100) sq ft × 2 coats ÷ 350 × 1.10 = 2.84 gal.
    expect(q.paint[0].gallons.toDecimalPlaces(2).toString()).toBe("2.84");
    expect(q.paint[2].gallons.toString()).toBe(gallons([4]).toString());
  });

  it("never guesses an amount without a coverage or a measurement", () => {
    expect(q.paint[3]).toMatchObject({ gallons: new Decimal(0), noCoverage: [uuid(7)], noQuantity: [] });
    expect(q.paint[2].noQuantity).toEqual([uuid(8)]);
  });

  it("returns nothing about money", () => {
    const json = JSON.stringify({ ...q, lineHours: Object.fromEntries(q.lineHours) });
    expect(json).not.toMatch(/price|cost|margin|"70"|"55"|900/i);
  });
});

describe("hoursLabel", () => {
  it("shows one decimal and never 0 for real work", () => {
    expect(hoursLabel(new Decimal("3.45"))).toBe("3.5");
    expect(hoursLabel(new Decimal("12"))).toBe("12");
    expect(hoursLabel(new Decimal("0.04"))).toBe("0.1");
    expect(hoursLabel(new Decimal("0"))).toBe("0");
    expect(hoursLabel(new Decimal("1234.56"))).toBe("1,234.6");
  });
});

describe("paintToBuy", () => {
  it.each([
    ["0", 0, 0, "0 gal"],
    ["0.2", 0, 1, "1 qt"],
    ["1", 1, 0, "1 gal"],
    ["1.0000001", 1, 0, "1 gal"],
    ["2.2", 2, 1, "2 gal + 1 qt"],
    ["2.3", 3, 0, "3 gal"],
    ["2.5", 3, 0, "3 gal"],
    ["2.84", 3, 0, "3 gal"],
    ["11.1", 11, 1, "11 gal + 1 qt"],
  ])("%s gal → %i gal + %i qt", (need, gallons, quarts, label) => {
    const buy = paintToBuy(new Decimal(need));
    expect(buy).toEqual({ gallons, quarts });
    expect(paintToBuyLabel(buy)).toBe(label);
  });
});

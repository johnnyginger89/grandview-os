import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocLine } from "@/lib/estimating/document";
import type { LineResult } from "@/lib/estimating/engine";
import { d } from "@/lib/money";
import type { MaterialOption } from "./editor-types";
import { costingNote, paintOptionLabel, useHideCosts } from "./hide-costs";

describe("useHideCosts", () => {
  it("hides costs in the server-rendered page, before this device's choice is known", () => {
    function Probe() {
      const [hide] = useHideCosts();
      return createElement("span", null, hide ? "hidden" : "shown");
    }
    expect(renderToString(createElement(Probe))).toBe("<span>hidden</span>");
  });
});

const duration = { productName: "Sherwin-Williams Duration Home Interior Matte", coverage: "350", pricePerGallon: "85.00" };

const walls: DocLine = {
  id: "00000000-0000-4000-8000-000000000001",
  areaId: null,
  description: "Walls – roll & cut",
  rateSnapshot: { rateVersion: 3, name: "Walls – roll & cut", unit: "sqft", basis: "units_per_hour", productionRate: "175", additionalCoatFactor: "0.85", defaultCoats: 2, material: duration, materialWastePct: "0.1", otherCostPerUnit: "0.03" },
  quantity: "352",
  quantitySource: "manual",
  coats: 2,
  prepFactor: "1",
  difficultyFactor: "1",
  conditionFactor: "1",
  accessFactor: "1",
  isOptional: false,
  optionSelected: false,
};

const door: DocLine = { ...walls, description: "Door slab (per side)", rateSnapshot: { ...walls.rateSnapshot, name: "Door slab (per side)", unit: "each", basis: "hours_per_unit", productionRate: "0.5" } };

const result: LineResult = {
  id: walls.id,
  calculatedHours: d("3.73"),
  hours: d("3.73"),
  hoursOverridden: false,
  laborRate: d("45"),
  laborCost: d("167.85"),
  gallons: d("2.21"),
  materialCost: d("187.85"),
  otherCost: d("10.56"),
  cost: d("366.26"),
  calculatedPrice: d("666"),
  price: d("666"),
  priceOverridden: false,
  margin: d("0.45"),
  included: true,
};

describe("costingNote", () => {
  it("shows labour, paint, other, cost and margin while costs show", () => {
    expect(costingNote(walls, result, true)).toBe("Rate: 175 sq ft/h (v3) · Labour $167.85 @ $45.00/h · Paint 2.21 gal $187.85 · Other $10.56 · Cost $366.26 · Margin 45.0%");
  });

  it("keeps only the rate and the paint quantity when costs are hidden", () => {
    expect(costingNote(walls, result, false)).toBe("Rate: 175 sq ft/h (v3) · Paint 2.21 gal");
    expect(costingNote(door, result, false)).toBe("Rate: 0.5 h/each (v3) · Paint 2.21 gal");
    for (const note of [costingNote(walls, result, false), costingNote(door, result, false)]) {
      expect(note).not.toMatch(/\$|%|Labour|Cost|Margin/i);
    }
  });
});

describe("paintOptionLabel", () => {
  const option: MaterialOption = { id: "m1", label: duration.productName, finish: "Matte", snapshot: duration };

  it("adds the price per gallon only while costs show", () => {
    expect(paintOptionLabel(option, true)).toBe("Sherwin-Williams Duration Home Interior Matte · $85.00/gal");
    expect(paintOptionLabel(option, false)).toBe("Sherwin-Williams Duration Home Interior Matte");
  });
});

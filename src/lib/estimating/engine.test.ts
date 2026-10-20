import { describe, expect, it } from "vitest";
import { marginToMarkup, markupToMargin, priceForMargin } from "@/lib/money";
import {
  areaQuantities,
  baseHours,
  calculateEstimate,
  calculateLine,
  coatFactor,
  crewDurationDays,
  type EstimateSettings,
  type LineInput,
  type RateSnapshot,
} from "./engine";

const walls: RateSnapshot = {
  name: "Interior walls – roll & cut",
  unit: "sqft",
  basis: "units_per_hour",
  productionRate: "200",
  additionalCoatFactor: "1",
  defaultCoats: 2,
  material: { productName: "SW Duration Home Matte", coverage: "350", pricePerGallon: "70", containerGallons: "3.78" },
  materialWastePct: "0.10",
  otherCostPerUnit: "0",
};

const doors: RateSnapshot = {
  name: "Door slab per side",
  unit: "each",
  basis: "hours_per_unit",
  productionRate: "0.5",
  additionalCoatFactor: "0.75",
  defaultCoats: 2,
  material: null,
  materialWastePct: "0",
  otherCostPerUnit: "2.50",
};

const settings: EstimateSettings = {
  pricingMethod: "target_margin",
  laborCostPerHour: "45",
  billingRatePerHour: "75",
  targetMargin: "0.50",
  materialMarkupPct: "0.20",
  minimumJobPrice: "2000",
  gstRate: "0.05",
  depositPct: "0.20",
};

function line(overrides: Partial<LineInput> & { rate: RateSnapshot }): LineInput {
  return { id: Math.random().toString(36), quantity: 0, coats: overrides.rate.defaultCoats, ...overrides };
}

describe("production-rate hours", () => {
  it("divides quantity by units-per-hour rate and multiplies by coats", () => {
    expect(baseHours(walls, 1000, 2).toString()).toBe("10");
  });

  it("supports hours-per-unit rates with a reduced second-coat factor", () => {
    // 4 doors × 0.5 h × (1 + 0.75) = 3.5 h
    expect(baseHours(doors, 4, 2).toString()).toBe("3.5");
    expect(coatFactor(3, "0.75").toString()).toBe("2.5");
    expect(coatFactor(0, "1").toString()).toBe("0");
  });

  it("applies prep, difficulty, condition and access multipliers", () => {
    const r = calculateLine(
      line({ rate: walls, quantity: 1000, multipliers: { prep: "1.2", difficulty: "1.1", condition: "1", access: "1.25" } }),
      settings,
    );
    // 10 h × 1.2 × 1.1 × 1.25 = 16.5 h
    expect(r.hours.toString()).toBe("16.5");
    expect(r.laborCost.toFixed(2)).toBe("742.50");
  });

  it("treats hourly rates as the quantity itself", () => {
    const hourly: RateSnapshot = { ...doors, unit: "hour", basis: "units_per_hour", productionRate: "1", otherCostPerUnit: "0" };
    expect(baseHours(hourly, 6, 1).toString()).toBe("6");
  });

  it("rejects a zero production rate", () => {
    expect(() => baseHours({ ...walls, productionRate: "0" }, 100, 1)).toThrow();
  });
});

describe("line pricing", () => {
  it("prices to target margin", () => {
    const r = calculateLine(line({ rate: walls, quantity: 1000 }), settings);
    // labour 10 h × 45 = 450; material 1000×2/350×1.1 = 6.2857 gal × 70 = 440.00
    expect(r.laborCost.toFixed(2)).toBe("450.00");
    expect(r.materialCost.toFixed(2)).toBe("440.00");
    expect(r.cost.toFixed(2)).toBe("890.00");
    expect(r.price.toFixed(2)).toBe("1780.00");
    expect(r.margin.toFixed(4)).toBe("0.5000");
  });

  it("prices by billing rate with marked-up materials", () => {
    const r = calculateLine(line({ rate: walls, quantity: 1000 }), { ...settings, pricingMethod: "billing_rate" });
    // 10 h × 75 + 440 × 1.2 = 750 + 528
    expect(r.price.toFixed(2)).toBe("1278.00");
  });

  it("keeps the calculated values when hours or price are overridden", () => {
    const r = calculateLine(line({ rate: walls, quantity: 1000, overrideHours: "12", overridePrice: "2500" }), settings);
    expect(r.calculatedHours.toString()).toBe("10");
    expect(r.hours.toString()).toBe("12");
    expect(r.hoursOverridden).toBe(true);
    expect(r.price.toFixed(2)).toBe("2500.00");
    expect(r.calculatedPrice.toFixed(2)).toBe("1960.00"); // (540 + 440) / 0.5
    expect(r.priceOverridden).toBe(true);
  });

  it("uses a rate-specific labour cost when set", () => {
    const r = calculateLine(line({ rate: { ...walls, laborCostPerHour: "60" }, quantity: 1000 }), settings);
    expect(r.laborCost.toFixed(2)).toBe("600.00");
  });
});

describe("estimate totals", () => {
  it("applies the minimum job price", () => {
    const res = calculateEstimate([line({ rate: doors, quantity: 2 })], [], settings);
    expect(res.totals.subtotal.lt(2000)).toBe(true);
    expect(res.totals.price.toFixed(2)).toBe("2000.00");
    expect(res.totals.gst.toFixed(2)).toBe("100.00");
    expect(res.totals.total.toFixed(2)).toBe("2100.00");
    expect(res.totals.deposit.toFixed(2)).toBe("420.00");
  });

  it("excludes unselected options but reports their value", () => {
    const res = calculateEstimate(
      [
        line({ rate: walls, quantity: 3000 }),
        line({ rate: walls, quantity: 1000, isOptional: true, optionSelected: false }),
      ],
      [],
      settings,
    );
    expect(res.totals.price.toFixed(2)).toBe("5340.00");
    expect(res.totals.unselectedOptionsPrice.toFixed(2)).toBe("1780.00");

    const selected = calculateEstimate(
      [
        line({ rate: walls, quantity: 3000 }),
        line({ rate: walls, quantity: 1000, isOptional: true, optionSelected: true }),
      ],
      [],
      settings,
    );
    expect(selected.totals.price.toFixed(2)).toBe("7120.00");
  });

  it("includes subcontractor and equipment costs", () => {
    const res = calculateEstimate(
      [line({ rate: walls, quantity: 3000 })],
      [
        { id: "pw", kind: "subcontractor", description: "Pressure washing sub", cost: "400" },
        { id: "lift", kind: "equipment", description: "Boom lift 2 days", cost: "600", markupPct: "0.15" },
      ],
      settings,
    );
    expect(res.totals.subcontractorCost.toFixed(2)).toBe("400.00");
    expect(res.totals.equipmentCost.toFixed(2)).toBe("600.00");
    // lines 5340 + sub 800 (target margin) + lift 690 (15 % markup)
    expect(res.totals.price.toFixed(2)).toBe("6830.00");
    expect(res.totals.totalCost.toFixed(2)).toBe("3670.00");
  });

  it("reports margin and markup distinctly", () => {
    const res = calculateEstimate([line({ rate: walls, quantity: 3000 })], [], settings);
    expect(res.totals.grossMargin.toFixed(4)).toBe("0.5000");
    expect(res.totals.markup.toFixed(4)).toBe("1.0000");
  });

  it("applies discount then a final price override", () => {
    const res = calculateEstimate([line({ rate: walls, quantity: 3000 })], [], { ...settings, discount: "340" });
    expect(res.totals.price.toFixed(2)).toBe("5000.00");
    const o = calculateEstimate([line({ rate: walls, quantity: 3000 })], [], { ...settings, priceOverride: "5500" });
    expect(o.totals.price.toFixed(2)).toBe("5500.00");
    expect(o.totals.overrideAdjustment.toFixed(2)).toBe("160.00");
  });

  it("summarizes materials by product with container counts", () => {
    const res = calculateEstimate(
      [line({ rate: walls, quantity: 3000 }), line({ rate: walls, quantity: 1000 })],
      [],
      settings,
    );
    expect(res.materials).toHaveLength(1);
    // 8000 / 350 × 1.1 = 25.14 gal → 7 × 3.78 L-gal cans
    expect(res.materials[0].gallons.toFixed(2)).toBe("25.14");
    expect(res.materials[0].containers).toBe(7);
  });

  it("produces an empty-but-valid result with no lines", () => {
    const res = calculateEstimate([], [], settings);
    expect(res.totals.price.toFixed(2)).toBe("0.00");
    expect(res.totals.minimumAdjustment.toFixed(2)).toBe("0.00");
  });
});

describe("helpers", () => {
  it("computes room quantities from dimensions", () => {
    const q = areaQuantities({ length: 12, width: 10, height: 8 });
    expect(q.walls.toString()).toBe("352");
    expect(q.ceiling.toString()).toBe("120");
    expect(q.perimeter.toString()).toBe("44");
  });

  it("converts margin and markup", () => {
    expect(marginToMarkup("0.5").toString()).toBe("1");
    expect(markupToMargin("1").toString()).toBe("0.5");
    expect(priceForMargin("12000", "0.52").toFixed(2)).toBe("25000.00");
  });

  it("estimates crew duration from capacity", () => {
    expect(crewDurationDays(120, 3, 8).toString()).toBe("5");
    expect(crewDurationDays(100, 3, 8).toString()).toBe("4.5");
  });
});

/**
 * Obviously fake estimate used by the Settings → Proposals preview. Never a real customer.
 */
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";

export const SAMPLE_CUSTOMER = {
  name: "Sample Customer [TEST DATA]",
  firstName: "Sample",
  contactName: "Sample Customer",
  phone: "604-555-0100",
  email: "sample.customer@example.com",
  jobAddress: "123 Example Street, Surrey, BC",
};

const rate = (name: string, category: string, proposalGroup: string | null, productName: string | null, unit: RateSnapshot["unit"] = "sqft"): RateSnapshot => ({
  rateId: null,
  rateVersion: null,
  name,
  unit,
  basis: unit === "each" || unit === "hour" ? "hours_per_unit" : "units_per_hour",
  productionRate: unit === "sqft" ? "175" : unit === "lnft" ? "50" : "1",
  additionalCoatFactor: "0.85",
  defaultCoats: 2,
  laborCostPerHour: null,
  billingRatePerHour: null,
  material: productName ? { productId: null, productName, coverage: "350", pricePerGallon: "85.00", containerGallons: "1" } : null,
  materialWastePct: "0.10",
  otherCostPerUnit: "0",
  category,
  customerLabel: null,
  proposalGroup,
});

const WALLS = rate("Walls – roll & cut", "Interior", "Walls", "Sherwin-Williams Duration Home Interior Matte");
const CEILINGS = rate("Ceilings – roll & cut", "Interior", "Ceilings", "Benjamin Moore Waterborne Ceiling Paint Flat");
const TRIM = rate("Baseboards", "Interior", "Trim", "Sherwin-Williams Emerald Urethane Trim Enamel Semi-Gloss", "lnft");
const DRYWALL = rate("Drywall patch – small", "Repairs", null, null, "each");

const A1 = "00000000-0000-4000-8000-0000000000a1";
const A2 = "00000000-0000-4000-8000-0000000000a2";
const A3 = "00000000-0000-4000-8000-0000000000a3";
const line = (id: string, areaId: string | null, snapshot: RateSnapshot, quantity: string, extra: Partial<EstimateDoc["lines"][number]> = {}): EstimateDoc["lines"][number] => ({
  id: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
  areaId,
  description: snapshot.name,
  customerDescription: null,
  customerDetail: null,
  rateSnapshot: snapshot,
  quantity,
  quantitySource: "manual",
  coats: snapshot.defaultCoats,
  prepFactor: "1",
  difficultyFactor: "1",
  conditionFactor: "1",
  accessFactor: "1",
  colour: null,
  sheen: null,
  overrideHours: null,
  overridePrice: null,
  isOptional: false,
  optionSelected: false,
  ...extra,
});

export const SAMPLE_DOC: EstimateDoc = {
  title: "[TEST DATA] Sample interior repaint",
  jobType: "interior",
  contractType: "fixed_price",
  internalNotes: null,
  customerNotes: "Colours to be confirmed at the colour consultation.",
  poNumber: null,
  areasExcluded: null,
  preparationOverride: null,
  settings: {
    pricingMethod: "billing_rate",
    laborCostPerHour: "45.00",
    billingRatePerHour: "80.00",
    targetMargin: "0.45",
    materialMarkupPct: "0.20",
    minimumJobPrice: "0",
    gstRate: "0.05",
    depositPct: "0.20",
    discount: null,
    priceOverride: null,
  },
  areas: [
    { id: A1, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null, notes: null, customerDescription: "Walls, ceiling and trim" },
    { id: A2, parentId: null, name: "Kitchen", kind: "room", length: null, width: null, height: null, notes: null, customerDescription: null },
    { id: A3, parentId: null, name: "Main bath", kind: "room", length: null, width: null, height: null, notes: null, customerDescription: null },
  ],
  lines: [
    line("1", A1, WALLS, "560", { colour: "SW 7008 Alabaster", sheen: "Matte" }),
    line("2", A1, TRIM, "70"),
    line("3", A2, WALLS, "380"),
    line("4", A3, WALLS, "220"),
    line("5", A1, CEILINGS, "300", { isOptional: true, customerDescription: "Living room ceiling", customerDetail: "- Two coats of flat ceiling white\n- Includes minor crack repair" }),
    line("6", A2, TRIM, "40", { isOptional: true, customerDescription: "Kitchen trim refresh" }),
    line("7", null, DRYWALL, "3", { customerDescription: "Drywall repairs", customerDetail: "Patch and sand three small dents in the hallway" }),
  ],
  costItems: [],
};

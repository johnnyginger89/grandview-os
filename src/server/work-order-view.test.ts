import { describe, expect, it, vi } from "vitest";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));

const { DEFAULT_PROPOSAL_TEMPLATE } = await import("@/db/seed-proposal-template");
const { buildWorkOrderView, changedSections, workOrderNumber } = await import("./work-order-view");
type WorkOrderInput = import("./work-order-view").WorkOrderInput;

// Same sentinels as the proposal-view test: none may reach a crew.
const SENTINELS = ["987.65", "123.45", "SECRET-INTERNAL", "SECRET-AREA", "4321.09", "77.77", "0.4567", "0.1919", "2222.22", "6543.21", "9.75"];
const FORBIDDEN_KEY = /price|cost|total|margin|markup|rate|hours|deposit|contract|discount|email/i;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KITCHEN = uuid(901);
const LIVING = uuid(902);
const CREW_A = uuid(801);
const CREW_B = uuid(802);

function snap(name: string, category: string, unit: RateSnapshot["unit"], product: string | null): RateSnapshot {
  return {
    rateId: uuid(500), rateVersion: 3, name, unit, basis: "units_per_hour", productionRate: "150", additionalCoatFactor: "0.85", defaultCoats: 2,
    laborCostPerHour: "987.65", billingRatePerHour: "123.45",
    material: product ? { productId: uuid(600), productName: product, coverage: "350", pricePerGallon: "77.77", containerGallons: "1" } : null,
    materialWastePct: "0.1919", otherCostPerUnit: "0.03", category, customerLabel: null, proposalGroup: null,
  };
}

function line(n: number, areaId: string | null, s: RateSnapshot, extra: Partial<EstimateDoc["lines"][number]> = {}): EstimateDoc["lines"][number] {
  return {
    id: uuid(n), areaId, description: s.name, customerDescription: null, customerDetail: null, rateSnapshot: s, quantity: "300", quantitySource: "manual",
    coats: 2, prepFactor: "1.15", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null,
    overrideHours: "2222.22", overridePrice: "6543.21", isOptional: false, optionSelected: false, ...extra,
  };
}

const WALLS = snap("Walls – roll & cut", "Interior", "sqft", "Sherwin-Williams Duration Home Interior Matte");
const TRIM = snap("Baseboards", "Interior", "lnft", "Sherwin-Williams Emerald Urethane Trim Enamel");
const CEIL = snap("Ceilings – roll & cut", "Interior", "sqft", "Benjamin Moore Waterborne Ceiling Paint");
const DOORS = snap("Doors", "Interior", "each", "Benjamin Moore Advance");
const PREP = snap("Sanding", "Prep", "hour", null);
const REPAIR = snap("Wood rot repair", "Repairs", "hour", null);

const doc: EstimateDoc = {
  title: "Interior repaint", jobType: "interior", contractType: "fixed_price", internalNotes: "SECRET-INTERNAL", customerNotes: "Colours at consult",
  poNumber: null, areasExcluded: "Garage\n- Closets", preparationOverride: null,
  settings: {
    pricingMethod: "target_margin", laborCostPerHour: "987.65", billingRatePerHour: "123.45", targetMargin: "0.4567", materialMarkupPct: "0.20",
    minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.20", discount: "9.75", priceOverride: null,
  },
  areas: [
    { id: KITCHEN, parentId: null, name: "Kitchen", kind: "room", length: "12", width: "10", height: "8", notes: "SECRET-AREA", customerDescription: "Walls and trim" },
    { id: LIVING, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null, notes: "SECRET-AREA", customerDescription: null },
  ],
  lines: [
    line(1, KITCHEN, WALLS, { quantitySource: "walls", quantity: "1", colour: "SW 7008 Alabaster", sheen: "Eggshell" }),
    line(2, KITCHEN, TRIM, { quantity: "70" }),
    line(3, LIVING, CEIL, { isOptional: true, optionSelected: false, customerDescription: "Living room ceiling (not chosen)" }),
    line(4, LIVING, DOORS, { isOptional: true, optionSelected: true, quantity: "3", customerDescription: "Paint 3 doors", customerDetail: "- Both sides\n- Frames too" }),
    line(5, null, PREP, { customerDetail: "Sand all glossy trim" }),
    line(6, null, REPAIR, { customerDescription: "Repair rot on the back door frame" }),
  ],
  costItems: [{ id: uuid(700), kind: "subcontractor", description: "Hidden sub 4321.09", customerDescription: "Lift", cost: "4321.09", markupPct: "0.25", overridePrice: null, isOptional: false, optionSelected: false }],
};

const input = (extra: Partial<WorkOrderInput> = {}): WorkOrderInput => ({
  workOrder: {
    number: 7001, title: "Interior repaint – main floor", specialInstructions: "Start upstairs.\n- Dog in the yard", equipment: "- 2 drop sheets per room", safetyNotes: null,
    accessNotes: null, showCustomerPhone: false, checklist: [{ id: "c1", text: "Take before photos" }], crewId: null,
  },
  version: 2,
  issuedAt: new Date("2026-10-22T18:00:00Z"),
  projectNumber: 3018,
  doc,
  template: DEFAULT_PROPOSAL_TEMPLATE,
  company: { name: "Grandview Painting Ltd.", displayName: "Grandview Painting", phone: "604-555-0199" },
  customer: { name: "[TEST DATA] Kim Lee", phone: "604-555-0100" },
  property: { street: "1 Example St", unit: null, city: "Surrey", province: "BC", postalCode: "V3S 0A1", accessNotes: "Lockbox by the side door" },
  crew: { name: "[TEST DATA] Niko", lead: "Niko (Dev)" },
  bookings: [
    { kind: "pressure_wash", phaseLabel: null, startDate: "2026-10-23", endDate: "2026-10-23", workDays: 1, crewId: CREW_B, crewName: "[TEST DATA] PW Co.", crewNotes: null },
    { kind: "work", phaseLabel: "Main floor", startDate: "2026-10-26", endDate: "2026-10-30", workDays: 5, crewId: CREW_A, crewName: "[TEST DATA] Niko", crewNotes: " Park on the street " },
  ],
  projectManager: { name: "[TEST DATA] Pat PM", phone: "604-555-0150" },
  show: { hours: false, paint: false },
  ...extra,
});

function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  return out;
}

describe("buildWorkOrderView", () => {
  const view = buildWorkOrderView(input());

  it("never contains money, rates or (with hours switched off) hours, as keys or values", () => {
    const json = JSON.stringify(view);
    for (const s of SENTINELS) expect(json, `must not contain ${s}`).not.toContain(s);
    expect(json).not.toContain("$");
    const keys = [...allKeys(view)];
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
  });

  it("has exactly the documented top-level keys", () => {
    expect(Object.keys(view).sort()).toEqual(
      [
        "viewVersion", "number", "version", "issuedOn", "title", "jobType", "jobTypeLabel", "projectNumber", "customerName", "customerPhone", "address", "mapsUrl",
        "accessNotes", "crew", "bookings", "projectManager", "scope", "preparation", "excluded", "specialInstructions", "equipment", "safety", "checklist",
      ].sort(),
    );
    expect(view).toMatchObject({ viewVersion: 1, number: "WO-7001", version: 2, issuedOn: "Oct 22, 2026", projectNumber: 3018, jobType: "interior", jobTypeLabel: "interior" });
    expect(workOrderNumber(7002)).toBe("WO-7002");
  });

  it("lists optional lines only when the customer selected them", () => {
    const titles = view.scope.flatMap((a) => a.items.map((i) => i.title));
    expect(titles).toContain("Paint 3 doors");
    expect(titles).not.toContain("Living room ceiling (not chosen)");
    expect(titles).not.toContain("Lift");
  });

  it("shows quantities from resolvedQuantity with units, never hours", () => {
    const kitchen = view.scope.find((a) => a.area === "Kitchen")!;
    expect(kitchen.description).toBe("Walls and trim");
    // Walls from dimensions: (12 + 10) × 2 × 8 = 352 sq ft.
    expect(kitchen.items[0]).toEqual({
      title: "Walls – roll & cut", quantity: "352", unit: "sq ft", coats: 2, product: "Sherwin-Williams Duration Home Interior Matte",
      colour: "SW 7008 Alabaster", sheen: "Eggshell", detail: [],
    });
    expect(kitchen.items[1]).toMatchObject({ quantity: "70", unit: "ln ft" });
    const living = view.scope.find((a) => a.area === "Living room")!;
    expect(living.items[0]).toMatchObject({ quantity: "3", unit: "each", detail: [{ type: "ul", items: ["Both sides", "Frames too"] }] });
    const general = view.scope.find((a) => a.area === "General")!;
    expect(general.items).toEqual([{ title: "Repair rot on the back door frame", quantity: null, unit: null, coats: null, product: null, colour: null, sheen: null, detail: [] }]);
  });

  it("puts prep lines and the job type's preparation under Preparation, and lists exclusions", () => {
    expect(view.preparation.at(-1)).toEqual({ type: "ul", items: ["Sand all glossy trim"] });
    expect(view.preparation.length).toBeGreaterThan(1);
    expect(JSON.stringify(view.preparation)).not.toMatch(/\{[A-Za-z_]+\}/);
    expect(view.scope.flatMap((a) => a.items.map((i) => i.title))).not.toContain("Sanding");
    expect(view.excluded).toEqual(["Garage", "Closets"]);
  });

  it("uses the preparation override when the estimator wrote one", () => {
    const v = buildWorkOrderView(input({ doc: { ...doc, preparationOverride: "- Wash walls\n- Fill holes" } }));
    expect(v.preparation[0]).toEqual({ type: "ul", items: ["Wash walls", "Fill holes"] });
  });

  it("shows the customer's phone only when ticked, and never their email", () => {
    expect(view.customerPhone).toBeNull();
    expect(buildWorkOrderView(input({ workOrder: { ...input().workOrder, showCustomerPhone: true } })).customerPhone).toBe("604-555-0100");
    expect(JSON.stringify(view)).not.toContain("@");
  });

  it("uses the access-notes override, else the property's notes", () => {
    expect(view.accessNotes).toBe("Lockbox by the side door");
    expect(buildWorkOrderView(input({ workOrder: { ...input().workOrder, accessNotes: "Use the back gate" } })).accessNotes).toBe("Use the back gate");
    expect(view.address).toBe("1 Example St, Surrey, BC V3S 0A1");
    expect(view.mapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=1%20Example/);
  });

  it("lists every booking for an all-crews work order, and only its crew's otherwise", () => {
    expect(view.bookings.map((b) => b.label)).toEqual(["Pressure wash", "Painting – Main floor"]);
    expect(view.bookings[1]).toEqual({ label: "Painting – Main floor", startDate: "2026-10-26", endDate: "2026-10-30", dates: "Mon, Oct 26 – Fri, Oct 30", workDays: 5, crewName: "[TEST DATA] Niko", crewNotes: "Park on the street" });
    const crewOnly = buildWorkOrderView(input({ workOrder: { ...input().workOrder, crewId: CREW_A } }));
    expect(crewOnly.bookings.map((b) => b.crewName)).toEqual(["[TEST DATA] Niko"]);
  });

  it("turns instructions into blocks and copies the checklist", () => {
    expect(view.specialInstructions).toEqual([{ type: "p", text: "Start upstairs." }, { type: "ul", items: ["Dog in the yard"] }]);
    expect(view.equipment).toEqual([{ type: "ul", items: ["2 drop sheets per room"] }]);
    expect(view.safety).toEqual([]);
    expect(view.checklist).toEqual([{ id: "c1", text: "Take before photos" }]);
  });
});

describe("labour hours and paint to order", () => {
  // Distinct products and no typed-over hours, so the amounts can be checked by hand.
  const own = (s: RateSnapshot, n: number): RateSnapshot => ({ ...s, material: s.material ? { ...s.material, productId: uuid(n) } : null });
  const measured: EstimateDoc = {
    ...doc,
    lines: [
      line(1, KITCHEN, own(WALLS, 610), { quantitySource: "walls", quantity: "1", colour: "SW 7008 Alabaster", sheen: "Eggshell", overrideHours: null }),
      line(2, KITCHEN, own(TRIM, 611), { quantity: "70", overrideHours: null }),
      line(3, LIVING, own(CEIL, 612), { isOptional: true, optionSelected: false, overrideHours: null }),
      line(4, LIVING, own(DOORS, 613), { isOptional: true, optionSelected: true, quantity: "3", customerDescription: "Paint 3 doors", overrideHours: null }),
      line(5, null, PREP, { quantity: "4", customerDetail: "Sand all glossy trim", overrideHours: null }),
      line(6, null, REPAIR, { quantity: "2", customerDescription: "Repair rot on the back door frame", overrideHours: null }),
    ],
  };
  const shown = buildWorkOrderView(input({ doc: measured, show: { hours: true, paint: true } }));

  it("shows hours per item, per area, for prep and for the job, and still no money", () => {
    const kitchen = shown.scope.find((a) => a.area === "Kitchen")!;
    // 352 sq ft ÷ 150 × (1 + 0.85) × 1.15 prep = 4.99 h; 70 ln ft the same way = 0.99 h.
    expect(kitchen.items.map((i) => i.hours)).toEqual(["5", "1"]);
    expect(kitchen.hours).toBe("6");
    // Hourly lines show their time as hours, not as a quantity.
    expect(shown.scope.find((a) => a.area === "General")!.items[0]).toMatchObject({ quantity: null, hours: "2.3" });
    expect(shown.prepHours).toBe("4.6");
    expect(shown.labourHours).toBe("12.9");

    const json = JSON.stringify(shown);
    for (const s of SENTINELS) expect(json, `must not contain ${s}`).not.toContain(s);
    expect(json).not.toContain("$");
    const keys = [...allKeys(shown)];
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k)).sort()).toEqual(["hours", "labourHours", "prepHours"]);
  });

  it("uses the estimator's hours when they were typed over", () => {
    const typed = buildWorkOrderView(input({ doc: { ...measured, lines: measured.lines.map((l, i) => (i === 0 ? { ...l, overrideHours: "7.25" } : l)) }, show: { hours: true, paint: false } }));
    expect(typed.scope[0].items[0].hours).toBe("7.3");
  });

  it("lists paint to buy by product, colour and sheen", () => {
    // Walls: 352 × 2 ÷ 350 × 1.1919 = 2.40 gal → 3 gal. Trim: 70 × 2 ÷ 350 × 1.1919 = 0.48 gal → 1 gal. Doors: 0.02 gal → 1 qt.
    expect(shown.paint).toEqual([
      { product: "Sherwin-Williams Duration Home Interior Matte", colour: "SW 7008 Alabaster", sheen: "Eggshell", amount: "3 gal", note: null },
      { product: "Sherwin-Williams Emerald Urethane Trim Enamel", colour: null, sheen: null, amount: "1 gal", note: null },
      { product: "Benjamin Moore Advance", colour: null, sheen: null, amount: "1 qt", note: null },
    ]);
  });

  it("says when an amount leaves something out instead of guessing", () => {
    const unmeasured = buildWorkOrderView(input({ doc: { ...measured, lines: [{ ...measured.lines[1], quantity: "0" }] }, show: { hours: false, paint: true } }));
    expect(unmeasured.paint).toEqual([{ product: "Sherwin-Williams Emerald Urethane Trim Enamel", colour: null, sheen: null, amount: null, note: "Not worked out: 1 item that wasn't measured. Ask the office." }]);
  });

  it("leaves hours and paint out entirely when switched off, so older versions compare equal", () => {
    const off = buildWorkOrderView(input({ doc: measured }));
    expect(Object.keys(off)).not.toEqual(expect.arrayContaining(["labourHours"]));
    expect("paint" in off || "prepHours" in off || "labourHours" in off).toBe(false);
    expect(off.scope.every((a) => !("hours" in a) && a.items.every((i) => !("hours" in i)))).toBe(true);
    expect(changedSections(off, shown)).toEqual(["scope", "paint", "preparation"]);
  });
});

describe("the customer's signed colours", () => {
  const colours = [
    { room: "Kitchen", surface: "Walls", colour: "Chantilly Lace", code: "OC-65", sheen: "Matte", lineId: uuid(1) },
    { room: "Kitchen", surface: "Baseboards", colour: "", code: "", sheen: "Semi-gloss", lineId: uuid(2) },
    { room: "Front door", surface: "Door", colour: "Hale Navy", code: "HC-154", sheen: "Gloss", lineId: null },
  ];
  const v = buildWorkOrderView(input({ colours, show: { hours: false, paint: true } }));

  it("put the chosen colour on the item it was chosen for, over the estimate's", () => {
    const walls = v.scope.find((a) => a.area === "Kitchen")!.items[0];
    expect(walls).toMatchObject({ colour: "OC-65 Chantilly Lace", sheen: "Matte" });
    // A row without a colour changes nothing.
    expect(v.scope.find((a) => a.area === "Kitchen")!.items[1]).toMatchObject({ colour: null, sheen: null });
  });

  it("list every coloured row, and buy paint in those colours", () => {
    expect(v.colours).toEqual([
      { room: "Kitchen", surface: "Walls", colour: "OC-65 Chantilly Lace", sheen: "Matte" },
      { room: "Front door", surface: "Door", colour: "HC-154 Hale Navy", sheen: "Gloss" },
    ]);
    expect(v.paint?.[0]).toMatchObject({ colour: "OC-65 Chantilly Lace", sheen: "Matte" });
  });

  it("count as a change to issue, and are left out when there are none", () => {
    const without = buildWorkOrderView(input({ show: { hours: false, paint: true } }));
    expect("colours" in without).toBe(false);
    expect(changedSections(without, v)).toEqual(["scope", "colours", "paint"]);
  });
});

describe("changedSections", () => {
  it("names the sections that differ between versions", () => {
    const v1 = buildWorkOrderView(input());
    const v2 = buildWorkOrderView(input({ version: 3, workOrder: { ...input().workOrder, specialInstructions: "Start downstairs." } }));
    expect(changedSections(v1, v2)).toEqual(["specialInstructions"]);
    const moved = buildWorkOrderView(input({ bookings: [input().bookings[1]] }));
    expect(changedSections(v1, moved)).toEqual(["bookings"]);
    expect(changedSections(null, v1)).toEqual([]);
    expect(changedSections(v1, buildWorkOrderView(input({ issuedAt: new Date("2026-11-01T18:00:00Z") })))).toEqual([]);
  });

  it("ignores key order, since Postgres jsonb stores keys reordered", () => {
    const reorder = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reorder) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
    const v1 = buildWorkOrderView(input({ workOrder: { ...input().workOrder, crewId: CREW_A } }));
    const stored = reorder(v1) as typeof v1;
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(v1));
    expect(changedSections(stored, v1)).toEqual([]);
    expect(changedSections(stored, { ...v1, specialInstructions: [] })).toEqual(["specialInstructions"]);
  });
});

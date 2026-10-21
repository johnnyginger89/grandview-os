import { describe, expect, it, vi } from "vitest";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));

const { DEFAULT_PROPOSAL_TEMPLATE: D } = await import("@/db/seed-proposal-template");
const { calculateDoc } = await import("@/lib/estimating/document");
const { buildProposalView, normalizeView } = await import("./proposal-view");
const { proposalTotals } = await import("./proposals");
const { buildPresentation } = await import("./proposal-presentation");

const SENTINELS = ["987.65", "123.45", "SECRET-INTERNAL", "SECRET-AREA", "4321.09", "77.77", "0.4567", "0.1919", "2222.22"];
const FORBIDDEN_KEYS = [
  "laborCostPerHour", "billingRatePerHour", "targetMargin", "materialMarkupPct", "minimumJobPrice", "pricingMethod", "rateSnapshot", "rateId",
  "rateVersion", "productionRate", "additionalCoatFactor", "defaultCoats", "pricePerGallon", "coverage", "containerGallons", "materialWastePct",
  "otherCostPerUnit", "productId", "prepFactor", "difficultyFactor", "conditionFactor", "accessFactor", "overrideHours", "overridePrice",
  "quantity", "hours", "totalCost", "cost", "markupPct", "discount", "priceOverride", "internalNotes", "notes", "tags", "source", "customFields",
  "estimatorId", "createdBy", "snapshot", "acceptedIp", "accepted_ip", "acceptedUserAgent", "accepted_user_agent", "data", "originalFilename",
];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KITCHEN = uuid(901);
const LIVING = uuid(902);

function snap(name: string, category: string, group: string | null, product: string | null, unit: RateSnapshot["unit"] = "sqft"): RateSnapshot {
  return {
    rateId: uuid(500),
    rateVersion: 3,
    name,
    unit,
    basis: "units_per_hour",
    productionRate: "150",
    additionalCoatFactor: "0.85",
    defaultCoats: 2,
    laborCostPerHour: "987.65",
    billingRatePerHour: "123.45",
    material: product ? { productId: uuid(600), productName: product, coverage: "350", pricePerGallon: "77.77", containerGallons: "1" } : null,
    materialWastePct: "0.1919",
    otherCostPerUnit: "0.03",
    category,
    customerLabel: null,
    proposalGroup: group,
  };
}

function line(n: number, areaId: string | null, s: RateSnapshot, extra: Partial<EstimateDoc["lines"][number]> = {}): EstimateDoc["lines"][number] {
  return {
    id: uuid(n), areaId, description: s.name, customerDescription: null, customerDetail: null, rateSnapshot: s, quantity: "300", quantitySource: "manual",
    coats: 2, prepFactor: "1.15", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null,
    overrideHours: null, overridePrice: null, isOptional: false, optionSelected: false, ...extra,
  };
}

const settings = {
  pricingMethod: "target_margin" as const, laborCostPerHour: "987.65", billingRatePerHour: "123.45", targetMargin: "0.4567",
  materialMarkupPct: "0.20", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.20", discount: null, priceOverride: null,
};

const WALLS = snap("Walls – roll & cut", "Interior", "Walls", "Sherwin-Williams Duration Home Interior Matte");
const TRIM = snap("Baseboards", "Interior", "Trim", "Sherwin-Williams Emerald Urethane Trim Enamel", "lnft");
const CEIL = snap("Ceilings – roll & cut", "Interior", "Ceilings", "Benjamin Moore Waterborne Ceiling Paint");
const PREP = snap("Sanding", "Prep", null, null);
const REPAIR = snap("Drywall patch – small", "Repairs", null, null, "each");

const interiorDoc: EstimateDoc = {
  title: "Interior repaint", jobType: "interior", contractType: "fixed_price", internalNotes: "SECRET-INTERNAL", customerNotes: "Colours at consult",
  poNumber: null, areasExcluded: null, preparationOverride: null, settings,
  areas: [
    { id: KITCHEN, parentId: null, name: "Kitchen", kind: "room", length: null, width: null, height: null, notes: "SECRET-AREA", customerDescription: null },
    { id: LIVING, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null, notes: "SECRET-AREA", customerDescription: "Walls and trim" },
  ],
  lines: [
    line(1, KITCHEN, WALLS, { colour: "SW 7008 Alabaster", sheen: "Eggshell" }),
    line(2, LIVING, WALLS),
    line(3, KITCHEN, TRIM, { overrideHours: "2222.22" }),
    line(4, LIVING, CEIL, { isOptional: true, customerDescription: "Living room ceiling", customerDetail: "- Flat white\n- Two coats" }),
    line(5, null, PREP, { customerDetail: "Sand all glossy trim" }),
    line(6, null, REPAIR, { customerDescription: "Drywall repairs" }),
  ],
  costItems: [
    { id: uuid(700), kind: "subcontractor", description: "Hidden sub", customerDescription: null, cost: "4321.09", markupPct: "0.25", overridePrice: null, isOptional: false, optionSelected: false },
    { id: uuid(701), kind: "equipment", description: "Lift rental", customerDescription: "Lift for high walls", cost: "100", markupPct: null, overridePrice: null, isOptional: false, optionSelected: false },
  ],
};

const EXT_SIDING = snap("Siding – brush & roll", "Exterior", "Siding", "Benjamin Moore Aura Exterior");
const EXT_TRIM = snap("Exterior trim", "Exterior", "Exterior Trim", "Benjamin Moore Arborcoat", "lnft");
const exteriorDoc: EstimateDoc = {
  ...interiorDoc, title: "Exterior repaint", jobType: "exterior", areas: [], customerNotes: null,
  areasExcluded: "Garage interior\nShed",
  lines: [line(11, null, EXT_SIDING), line(12, null, EXT_TRIM)],
  costItems: [],
};

const company = { name: "Grandview Painting Ltd.", displayName: "Grandview Painting", email: "info@grandviewpainting.ca", phone: "604-555-0199", address: "1 Example St\nSurrey, BC", gstNumber: "123456789", licenceLabel: "License", licenceNumber: "181767", website: "https://www.grandviewpainting.ca/" };
const customer = { name: "Sample Customer [TEST DATA]", firstName: "Sample", contactName: "Sample Customer", phone: "604-555-0100" };
const build = (doc: EstimateDoc, message: string | null = null) =>
  buildProposalView({ doc, number: 5012, revision: 1, customer, jobAddress: "123 Example Street, Surrey, BC", validUntil: new Date("2026-11-20T08:00:00Z"), company, template: D, message });

function assertCustomerSafe(value: unknown) {
  const json = JSON.stringify(value);
  for (const s of SENTINELS) expect(json, `must not contain ${s}`).not.toContain(s);
  for (const k of FORBIDDEN_KEYS) expect(json, `must not contain key ${k}`).not.toContain(`"${k}":`);
}

describe("buildProposalView", () => {
  const view = build(interiorDoc);

  it("never contains costs, rates or internal notes", () => {
    assertCustomerSafe(view);
  });

  it("numbers lines in Markate order", () => {
    expect(view.lines.map((l) => [l.no, l.kind, l.title])).toEqual([
      [1, "preparation", "Interior Preparation"],
      [2, "option", "Optional Living room ceiling"],
      [3, "areas", "Areas To Be Painted"],
      [4, "paint", "Paint Walls"],
      [5, "paint", "Paint Trim"],
      [6, "item", "Drywall repairs"],
      [7, "item", "Lift for high walls"],
      [8, "notes", "Notes"],
      [9, "services", "Services Include"],
    ]);
    expect(view.displayNumber).toBe("EST-5012");
    expect(view.lines[0].blocks.at(-1)).toEqual({ type: "ul", items: ["Sand all glossy trim"] });
  });

  it("lists areas with their customer description", () => {
    expect(view.lines[2].blocks).toEqual([{ type: "p", text: "Areas to be painted include :" }, { type: "ul", items: ["Kitchen", "Living room: Walls and trim"] }]);
  });

  it("groups paint lines: all walls vs trim in one room, with colours", () => {
    expect(view.lines[3].blocks[0]).toEqual({ type: "p", text: "Apply 2 coats, Sherwin-Williams Duration Home Interior Matte to all walls" });
    expect(view.lines[3].blocks[1]).toEqual({ type: "p", text: "Colour: SW 7008 Alabaster, Eggshell" });
    expect(view.lines[4].blocks[0]).toEqual({ type: "p", text: "Apply 2 coats, Sherwin-Williams Emerald Urethane Trim Enamel to trim in Kitchen" });
  });

  it("omits the excluded line when empty, and numbers it correctly when present", () => {
    expect(view.lines.some((l) => l.kind === "excluded")).toBe(false);
    const ext = build(exteriorDoc);
    const ex = ext.lines.find((l) => l.kind === "excluded")!;
    const areasNo = ext.lines.find((l) => l.kind === "areas")!.no;
    expect(ex.blocks).toContainEqual({ type: "ul", items: ["Garage interior", "Shed"] });
    expect(ex.blocks.at(-1)).toEqual({ type: "p", text: `Any other area not listed in line # ${areasNo}` });
    expect(ext.lines.find((l) => l.kind === "areas")!.blocks.at(-1)).toEqual({ type: "ul", items: ["Siding", "Exterior Trim"] });
  });

  it("options carry the engine price and their line number", () => {
    const enginePrice = calculateDoc(interiorDoc).lines.find((l) => l.id === uuid(4))!.price.toFixed(2);
    expect(view.options).toEqual([
      { id: uuid(4), title: "Optional Living room ceiling", detail: [{ type: "ul", items: ["Flat white", "Two coats"] }], area: "Living room", price: enginePrice, recommended: false, lineNo: 2 },
    ]);
    expect(view.lines[1].price).toBe(enginePrice);
  });

  it("hidden cost items still count in the totals", () => {
    const without = { ...interiorDoc, costItems: interiorDoc.costItems.slice(1) };
    expect(Number(proposalTotals(interiorDoc, []).price)).toBeGreaterThan(Number(proposalTotals(without, []).price));
    expect(JSON.stringify(view)).not.toContain("Hidden sub");
  });

  it("interior terms leave out exterior clauses; exterior terms include them and drop the interior clean-up", () => {
    const interior = view.contract.terms.items.join("\n");
    expect(interior).not.toContain("neighbouring properties");
    expect(interior).not.toContain("Access to the house");
    expect(interior).not.toContain("Access to your roof");
    expect(interior).toContain("contractor grade");
    expect(interior).toContain("an additional $250");
    const exterior = build(exteriorDoc).contract.terms.items.join("\n");
    expect(exterior).toContain("neighbouring properties");
    expect(exterior).toContain("Access to the house");
    expect(exterior).toContain("Access to your roof");
    expect(exterior).not.toContain("contractor grade");
    expect(exterior).toContain("(exterior work means prior to pressure washing)");
  });

  it("warranty months follow the job type", () => {
    expect(view.contract.warranty.months).toBe(24);
    expect(view.contract.warranty.intro[0]).toMatchObject({ text: expect.stringContaining("a period of 24 months") });
    expect(build(exteriorDoc).contract.warranty.months).toBe(36);
    expect(build(exteriorDoc).contract.warranty.intro[0]).toMatchObject({ text: expect.stringContaining("36 months") });
  });

  it("fills the default message and payment wording with the deposit", () => {
    expect(view.message).toContain("A 20% booking deposit is required upon accepting.");
    expect(view.contract.payment.items[0]).toBe("Customer must pay 20% deposit of total estimate price upon acceptance of estimate.");
    expect(build(interiorDoc, "Great meeting you").message).toBe("Great meeting you");
    expect(view.contract.quality.items[0]).toContain("https://pcapainted.org/");
  });

  it("company block uses display name, licence, address lines and tel links", () => {
    expect(view.company).toMatchObject({ displayName: "Grandview Painting", legalName: "Grandview Painting Ltd.", addressLines: ["1 Example St", "Surrey, BC"] });
    expect(view.company.phones).toEqual([{ label: "", number: "604-555-0199", tel: "tel:+16045550199" }]);
  });
});

describe("normalizeView", () => {
  const v1 = {
    number: 5003, revision: 1, title: "Old proposal", customerName: "Sample Customer [TEST DATA]", contactName: "Sample Customer", address: "1 Example St",
    issuedOn: "Oct 1, 2026", validUntil: "Oct 31, 2026", company: { name: "Grandview Painting Ltd.", phone: "604-555-0199", email: "info@grandviewpainting.ca", address: "", gstNumber: "" },
    intro: "Thank you", message: "Hello", customerNotes: "Note", showAreaPrices: true,
    areas: [{ id: uuid(1), name: "Living room", price: "1200.00", items: [{ id: uuid(2), title: "Walls – roll & cut", detail: "2 coats" }] }],
    options: [{ id: uuid(3), title: "Ceilings – roll & cut", area: "Living room", price: "350.00", recommended: true }],
    products: [{ name: "Sherwin-Williams Duration", colours: ["SW 7008"] }],
    gstRate: "0.05", depositPct: "0.20",
    sections: { preparation: "Prep text", inclusions: ["Labour"], exclusions: ["Permits"], warranty: "2 years", paymentTerms: "Deposit", terms: "Terms text" },
  };
  it("maps a v1 view without throwing and keeps the totals inputs", () => {
    const v = normalizeView(v1, "interior");
    expect(v.viewVersion).toBe(2);
    expect(v.legacy).toBe(true);
    expect(v.options).toEqual([{ id: uuid(3), title: "Ceilings – roll & cut", detail: [], area: "Living room", price: "350.00", recommended: true, lineNo: 3 }]);
    expect(v.gstRate).toBe("0.05");
    expect(v.depositPct).toBe("0.20");
    expect(v.lines.map((l) => l.kind)).toEqual(["areas", "item", "option", "item", "notes"]);
    expect(v.message).toBe("Hello\n\nThank you");
    expect(v.contract.payment.items).toEqual(["Deposit"]);
    expect(v.jobTypeLabel).toBe("interior");
  });
  it("returns v2 unchanged and survives junk", () => {
    const v2 = build(interiorDoc);
    expect(normalizeView(v2, "exterior")).toBe(v2);
    expect(() => normalizeView(null, "interior")).not.toThrow();
    expect(normalizeView({}, "nope").lines).toEqual([]);
  });
});

describe("buildPresentation", () => {
  const view = build(interiorDoc);
  const doc = (purpose: "insurance_certificate" | "worksafebc_clearance", expiresOn: string | null, status: "valid" | "expiring" | "expired") => ({
    purpose, defaultTitle: purpose === "insurance_certificate" ? "Liability insurance certificate" : "WorkSafeBC clearance letter", id: uuid(purpose === "insurance_certificate" ? 801 : 802),
    title: null, contentType: "application/pdf", effectiveOn: null, expiresOn, readyAt: new Date("2026-10-15T18:00:00Z"), status,
  });

  it("shows only unexpired documents, through the stable token link", async () => {
    const p = await buildPresentation(view, {
      token: "t".repeat(32),
      deps: { template: D, company: { ...company, tagline: "Quality focused. Integrity driven." }, documents: [doc("insurance_certificate", "2027-01-10", "valid"), doc("worksafebc_clearance", "2026-04-01", "expired")], knownMedia: new Set() },
    });
    expect(p.resources.insurance.documents).toEqual([
      { label: "View liability insurance certificate (PDF)", href: `/share/p/${"t".repeat(32)}/documents/insurance_certificate`, updated: "Updated Oct 2026", validTo: "Valid to Jan 10, 2027" },
    ]);
    assertCustomerSafe(p);
  });

  it("personalises the cover and falls back to the default image for a missing upload", async () => {
    const missing = "media:00000000-0000-4000-8000-000000000999";
    const tpl = { ...D, jobTypes: { ...D.jobTypes, interior: { ...D.jobTypes.interior, cover: { ...D.jobTypes.interior.cover, heroImage: { src: missing, alt: "x", focalX: 50, focalY: 50 } } } } };
    const p = await buildPresentation(view, { mode: "sample", deps: { template: tpl, company, documents: [doc("insurance_certificate", null, "valid")], knownMedia: new Set() } });
    expect(p.cover.headline).toBe("Sample, it's what's inside that counts");
    expect(p.cover.hero.url).toBe("/proposal/hero-interior.jpg");
    expect(p.cover.intro.at(-1)).toMatchObject({ text: expect.stringContaining("quote your interior painting project") });
    expect(p.resources.insurance.documents[0].href).toBe(`/api/media/${uuid(801)}`);
    expect(p.nav).toHaveLength(8);
    expect(p.whyUs.tiles).toHaveLength(6);
    expect(p.reviews.featured?.author).toBe("Steve B.");
    expect(p.reviews.items).toHaveLength(3);
  });
});

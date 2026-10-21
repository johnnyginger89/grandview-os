import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));

const { DEFAULT_PROPOSAL_TEMPLATE } = await import("@/db/seed-proposal-template");
const { buildWorkOrderView } = await import("@/server/work-order-view");
const { updateNotice, WorkOrderDocument } = await import("./work-order-document");
type WorkOrderView = import("@/server/work-order-view").WorkOrderView;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROOM = uuid(1);
const SENTINELS = ["987.65", "123.45", "SECRET-INTERNAL", "SECRET-AREA", "77.77", "2222.22", "6543.21", "4321.09"];

const rate: RateSnapshot = {
  rateId: uuid(2), rateVersion: 1, name: "Walls – roll & cut", unit: "sqft", basis: "units_per_hour", productionRate: "150", additionalCoatFactor: "0.85", defaultCoats: 2,
  laborCostPerHour: "987.65", billingRatePerHour: "123.45",
  material: { productId: uuid(3), productName: "Benjamin Moore Regal Select", coverage: "350", pricePerGallon: "77.77", containerGallons: "1" },
  materialWastePct: "0.1", otherCostPerUnit: "0.03", category: "Interior", customerLabel: null, proposalGroup: null,
};

const doc: EstimateDoc = {
  title: "Interior repaint", jobType: "interior", contractType: "fixed_price", internalNotes: "SECRET-INTERNAL", customerNotes: null, poNumber: null,
  areasExcluded: "Garage", preparationOverride: null,
  settings: { pricingMethod: "target_margin", laborCostPerHour: "987.65", billingRatePerHour: "123.45", targetMargin: "0.45", materialMarkupPct: "0.2", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.2", discount: "0", priceOverride: "6543.21" },
  areas: [{ id: ROOM, parentId: null, name: "Living room", kind: "room", length: "12", width: "10", height: "8", notes: "SECRET-AREA", customerDescription: null }],
  lines: [
    {
      id: uuid(4), areaId: ROOM, description: "Walls – roll & cut", customerDescription: null, customerDetail: null, rateSnapshot: rate, quantity: "1", quantitySource: "walls",
      coats: 2, prepFactor: "1", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: "SW 7008 Alabaster", sheen: "Eggshell",
      overrideHours: "2222.22", overridePrice: "6543.21", isOptional: false, optionSelected: false,
    },
  ],
  costItems: [{ id: uuid(5), kind: "subcontractor", description: "Hidden 4321.09", customerDescription: null, cost: "4321.09", markupPct: "0.2", overridePrice: null, isOptional: false, optionSelected: false }],
};

function view(extra: { specialInstructions?: string | null; phone?: boolean } = {}): WorkOrderView {
  return buildWorkOrderView({
    workOrder: {
      number: 7001, title: "Interior repaint", specialInstructions: extra.specialInstructions === undefined ? "Start upstairs.\n- Dog in the yard" : extra.specialInstructions,
      equipment: null, safetyNotes: null, accessNotes: "Gate code 1234", showCustomerPhone: !!extra.phone, checklist: [{ id: "c1", text: "Take before photos" }], crewId: null,
    },
    version: 2,
    issuedAt: new Date("2026-10-22T18:00:00Z"),
    projectNumber: 3018,
    doc,
    template: DEFAULT_PROPOSAL_TEMPLATE,
    company: { name: "Grandview Painting Ltd.", displayName: "Grandview Painting", phone: "604-555-0199" },
    customer: { name: "[TEST DATA] Kim Lee", phone: "604-555-0100" },
    property: { street: "1 Example St", unit: null, city: "Surrey", province: "BC", postalCode: "V3S 0A1", accessNotes: null },
    crew: null,
    bookings: [{ kind: "work", phaseLabel: null, startDate: "2026-10-26", endDate: "2026-10-30", workDays: 5, crewId: uuid(6), crewName: "[TEST DATA] Niko", crewNotes: null }],
    projectManager: { name: "[TEST DATA] Pat PM", phone: "604-555-0150" },
  });
}

const OFFICE = { name: "Grandview Painting", phone: "604-555-0199" };
const render = (props: Parameters<typeof WorkOrderDocument>[0]) => renderToStaticMarkup(createElement(WorkOrderDocument, props));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("WorkOrderDocument", () => {
  const html = render({ view: view(), office: OFFICE });

  it("shows what the crew needs: address, scope, coats, colour, instructions and checklist", () => {
    const t = text(html);
    for (const s of ["WO-7001 · Version 2", "Issued Oct 22, 2026", "1 Example St, Surrey, BC V3S 0A1", "Gate code 1234", "Walls – roll & cut", "352 sq ft", "2 coats", "Colour: SW 7008 Alabaster", "Sheen: Eggshell", "Mon, Oct 26 – Fri, Oct 30", "5 work days", "Start upstairs.", "Dog in the yard", "Garage", "Take before photos", "Questions? Call the office."])
      expect(t, s).toContain(s);
  });

  it("never shows money, rates, hours or internal notes", () => {
    for (const s of SENTINELS) expect(html, s).not.toContain(s);
    expect(html).not.toContain("$");
    expect(html).not.toMatch(/\bhours?\b/i);
    expect(html).not.toMatch(/price|cost|margin/i);
  });

  it("opens maps without a referrer and only links phones that are shown", () => {
    expect(html).toMatch(/<a href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=1%20Example[^"]*" target="_blank" rel="noreferrer noopener"/);
    expect(html).not.toContain("tel:6045550100");
    expect(html).toContain('href="tel:6045550150"');
    expect(html).toContain('href="tel:6045550199"');
    expect(render({ view: view({ phone: true }), office: OFFICE })).toContain('href="tel:6045550100"');
  });

  it("highlights changed sections and says when something was removed", () => {
    const v = view({ specialInstructions: null });
    const out = render({ view: v, office: OFFICE, changed: ["specialInstructions", "bookings"], notice: updateNotice(v, 1, 2) });
    expect(out).toContain('data-section="specialInstructions" data-changed="true"');
    expect(out).toContain('data-section="bookings" data-changed="true"');
    expect(out).not.toContain('data-section="scope" data-changed');
    expect(text(out)).toContain("Removed in this version.");
    expect(out.match(/>Changed</g)).toHaveLength(2);
    expect(text(out)).toContain("Updated Oct 22, 2026: version 2 replaces version 1. Check the highlighted sections.");
    // Without changes, empty sections stay hidden.
    expect(render({ view: v, office: OFFICE })).not.toContain('data-section="specialInstructions"');
  });
});

/**
 * Baseline configuration seeded into every environment.
 *
 * Production rates and material prices here are STARTING VALUES ONLY,
 * typical of residential repaint work. They are meant to be replaced by
 * Grandview's own rates (imported from PaintScout) before real estimates
 * are sent. Every seeded rate carries the change note "Starter value".
 */
import type { FactorKind } from "./schema/estimating";

export const PIPELINE_STAGES = [
  { key: "new_lead", name: "New Lead – To Contact", kind: "open", color: "amber", staleAfterDays: 1 },
  { key: "contacted", name: "Contacted", kind: "open", color: "sky", staleAfterDays: 3 },
  { key: "estimate_booked", name: "Estimate Booked", kind: "open", color: "blue", staleAfterDays: null },
  { key: "estimate_completed", name: "Estimate Completed", kind: "open", color: "violet", staleAfterDays: 2 },
  { key: "proposal_sent", name: "Proposal Sent", kind: "open", color: "indigo", staleAfterDays: 4 },
  { key: "follow_up", name: "Follow-Up", kind: "open", color: "orange", staleAfterDays: 7 },
  { key: "on_hold", name: "On Hold / Next Season", kind: "open", color: "slate", staleAfterDays: 30 },
  { key: "won", name: "Won", kind: "won", color: "emerald", staleAfterDays: null },
  { key: "lost", name: "Lost", kind: "lost", color: "rose", staleAfterDays: null },
] as const;

export const LOST_REASONS = [
  "Price",
  "Went with another contractor",
  "No response",
  "Project cancelled / postponed",
  "Outside service area",
  "Service we don't offer",
  "Job too small",
  "Declined to bid",
  "Spam / wrong number",
];

export const LEAD_SOURCES = [
  "Google Search",
  "Google Ads",
  "Referral",
  "Repeat Client",
  "Facebook Ads",
  "Social Media",
  "Best Picks",
  "Nextdoor",
  "Yard / Van Sign",
  "Mailer",
  "Paint Store",
  "Realtor / Property Mgr",
  "Home Show / Event",
  "Other",
];

export const PROJECT_TYPES = [
  "Interior",
  "Exterior",
  "Cabinets",
  "Deck / Fence Staining",
  "Pressure Washing",
  "Carpentry / Repairs",
  "Drywall / Popcorn Removal",
  "Commercial",
  "Strata",
];

export const FACTORS: { kind: FactorKind; label: string; value: string; isDefault?: boolean }[] = [
  { kind: "prep", label: "Minimal", value: "1.000", isDefault: true },
  { kind: "prep", label: "Standard", value: "1.150" },
  { kind: "prep", label: "Heavy", value: "1.350" },
  { kind: "prep", label: "Extensive", value: "1.600" },
  { kind: "difficulty", label: "Standard", value: "1.000", isDefault: true },
  { kind: "difficulty", label: "Moderate (cut-in heavy, colour change)", value: "1.150" },
  { kind: "difficulty", label: "Difficult (many obstacles, dark-to-light)", value: "1.300" },
  { kind: "condition", label: "Good", value: "1.000", isDefault: true },
  { kind: "condition", label: "Fair", value: "1.100" },
  { kind: "condition", label: "Poor", value: "1.250" },
  { kind: "access", label: "Floor / ground", value: "1.000", isDefault: true },
  { kind: "access", label: "Step ladder / high ceiling (9–12 ft)", value: "1.150" },
  { kind: "access", label: "Extension ladder – 2 storey", value: "1.300" },
  { kind: "access", label: "3 storey / lift / scaffold", value: "1.500" },
];

export const MATERIALS = [
  { key: "sw-duration-int", manufacturer: "Sherwin-Williams", name: "Duration Home Interior", finish: "Matte", pricePerGallon: "85.00", coverage: "350", containerGallons: "1" },
  { key: "sw-emerald-int", manufacturer: "Sherwin-Williams", name: "Emerald Interior", finish: "Matte", pricePerGallon: "95.00", coverage: "350", containerGallons: "1" },
  { key: "sw-emerald-urethane", manufacturer: "Sherwin-Williams", name: "Emerald Urethane Trim Enamel", finish: "Semi-Gloss", pricePerGallon: "105.00", coverage: "350", containerGallons: "1" },
  { key: "sw-superpaint-ext", manufacturer: "Sherwin-Williams", name: "SuperPaint Exterior", finish: "Satin", pricePerGallon: "80.00", coverage: "300", containerGallons: "1" },
  { key: "bm-regal-int", manufacturer: "Benjamin Moore", name: "Regal Select Interior", finish: "Eggshell", pricePerGallon: "88.00", coverage: "375", containerGallons: "1" },
  { key: "bm-aura-int", manufacturer: "Benjamin Moore", name: "Aura Interior", finish: "Matte", pricePerGallon: "110.00", coverage: "375", containerGallons: "1" },
  { key: "bm-advance", manufacturer: "Benjamin Moore", name: "Advance Interior", finish: "Semi-Gloss", pricePerGallon: "100.00", coverage: "375", containerGallons: "1" },
  { key: "bm-ceiling", manufacturer: "Benjamin Moore", name: "Waterborne Ceiling Paint", finish: "Flat", pricePerGallon: "60.00", coverage: "400", containerGallons: "1" },
  { key: "bm-aura-ext", manufacturer: "Benjamin Moore", name: "Aura Exterior", finish: "Low Lustre", pricePerGallon: "115.00", coverage: "300", containerGallons: "1" },
  { key: "bm-arborcoat", manufacturer: "Benjamin Moore", name: "Arborcoat Semi-Transparent Stain", finish: "Semi-Transparent", pricePerGallon: "85.00", coverage: "250", containerGallons: "1" },
  { key: "cl-horizon-int", manufacturer: "Cloverdale", name: "Horizon Interior", finish: "Eggshell", pricePerGallon: "65.00", coverage: "375", containerGallons: "1" },
  { key: "cl-horizon-ext", manufacturer: "Cloverdale", name: "Horizon Exterior", finish: "Satin", pricePerGallon: "70.00", coverage: "300", containerGallons: "1" },
  { key: "cl-primer", manufacturer: "Cloverdale", name: "Sureseal Primer", finish: "Flat", pricePerGallon: "55.00", coverage: "300", containerGallons: "1" },
  { key: "sw-cabinet", manufacturer: "Sherwin-Williams", name: "Emerald Urethane (Cabinets)", finish: "Satin", pricePerGallon: "105.00", coverage: "300", containerGallons: "1" },
] as const;

type MaterialKey = (typeof MATERIALS)[number]["key"];

export interface SeedRate {
  code: string;
  name: string;
  category: string;
  unit: "sqft" | "lnft" | "each" | "hour";
  basis?: "units_per_hour" | "hours_per_unit";
  dimensionSource?: "manual" | "walls" | "ceiling" | "floor" | "perimeter";
  productionRate: string;
  additionalCoatFactor?: string;
  defaultCoats: number;
  material?: MaterialKey;
  otherCostPerUnit?: string;
  /** How the proposal groups this rate ("Paint Walls", "Paint Exterior Trim"). None = not a paint line. */
  proposalGroup?: string;
}

export const RATES: SeedRate[] = [
  // Interior
  { code: "INT-WALL", name: "Walls – roll & cut", category: "Interior", unit: "sqft", dimensionSource: "walls", productionRate: "175", additionalCoatFactor: "0.85", defaultCoats: 2, material: "sw-duration-int", otherCostPerUnit: "0.03", proposalGroup: "Walls" },
  { code: "INT-CEIL", name: "Ceilings – roll & cut", category: "Interior", unit: "sqft", dimensionSource: "ceiling", productionRate: "140", additionalCoatFactor: "0.85", defaultCoats: 2, material: "bm-ceiling", otherCostPerUnit: "0.03", proposalGroup: "Ceilings" },
  { code: "INT-BASE", name: "Baseboards", category: "Interior", unit: "lnft", dimensionSource: "perimeter", productionRate: "50", additionalCoatFactor: "0.85", defaultCoats: 2, material: "sw-emerald-urethane", proposalGroup: "Trim" },
  { code: "INT-CROWN", name: "Crown moulding", category: "Interior", unit: "lnft", productionRate: "30", additionalCoatFactor: "0.85", defaultCoats: 2, material: "sw-emerald-urethane", proposalGroup: "Trim" },
  { code: "INT-DCAS", name: "Door casing (per side)", category: "Interior", unit: "each", basis: "hours_per_unit", productionRate: "0.35", additionalCoatFactor: "0.8", defaultCoats: 2, material: "sw-emerald-urethane", proposalGroup: "Trim" },
  { code: "INT-DOOR", name: "Door slab (per side)", category: "Interior", unit: "each", basis: "hours_per_unit", productionRate: "0.5", additionalCoatFactor: "0.8", defaultCoats: 2, material: "sw-emerald-urethane", proposalGroup: "Doors" },
  { code: "INT-JAMB", name: "Door frame / jamb", category: "Interior", unit: "each", basis: "hours_per_unit", productionRate: "0.35", additionalCoatFactor: "0.8", defaultCoats: 2, material: "sw-emerald-urethane", proposalGroup: "Trim" },
  { code: "INT-WCAS", name: "Window casing & sill", category: "Interior", unit: "each", basis: "hours_per_unit", productionRate: "0.5", additionalCoatFactor: "0.8", defaultCoats: 2, material: "sw-emerald-urethane", proposalGroup: "Trim" },
  { code: "INT-RAIL", name: "Handrail / spindles", category: "Interior", unit: "lnft", productionRate: "8", additionalCoatFactor: "0.85", defaultCoats: 2, material: "sw-emerald-urethane", proposalGroup: "Trim" },
  // Exterior
  { code: "EXT-SIDING", name: "Siding – brush & roll", category: "Exterior", unit: "sqft", productionRate: "120", additionalCoatFactor: "0.85", defaultCoats: 2, material: "sw-superpaint-ext", otherCostPerUnit: "0.04", proposalGroup: "Siding" },
  { code: "EXT-SIDING-SPRAY", name: "Siding – spray & back-roll", category: "Exterior", unit: "sqft", productionRate: "220", additionalCoatFactor: "0.85", defaultCoats: 2, material: "sw-superpaint-ext", otherCostPerUnit: "0.06", proposalGroup: "Siding" },
  { code: "EXT-FASCIA", name: "Fascia", category: "Exterior", unit: "lnft", productionRate: "40", additionalCoatFactor: "0.85", defaultCoats: 2, material: "sw-superpaint-ext", proposalGroup: "Exterior Trim" },
  { code: "EXT-SOFFIT", name: "Soffits", category: "Exterior", unit: "sqft", productionRate: "80", additionalCoatFactor: "0.85", defaultCoats: 2, material: "sw-superpaint-ext", proposalGroup: "Exterior Trim" },
  { code: "EXT-TRIM", name: "Exterior trim", category: "Exterior", unit: "lnft", productionRate: "35", additionalCoatFactor: "0.85", defaultCoats: 2, material: "sw-superpaint-ext", proposalGroup: "Exterior Trim" },
  { code: "EXT-DOOR", name: "Exterior door (per side)", category: "Exterior", unit: "each", basis: "hours_per_unit", productionRate: "0.75", additionalCoatFactor: "0.8", defaultCoats: 2, material: "bm-aura-ext", proposalGroup: "Exterior Doors" },
  { code: "EXT-GARAGE", name: "Garage door", category: "Exterior", unit: "each", basis: "hours_per_unit", productionRate: "1.5", additionalCoatFactor: "0.8", defaultCoats: 2, material: "sw-superpaint-ext", proposalGroup: "Exterior Doors" },
  // Stain & specialty
  { code: "STN-FENCE", name: "Fence staining", category: "Staining", unit: "sqft", productionRate: "110", additionalCoatFactor: "0.85", defaultCoats: 1, material: "bm-arborcoat", proposalGroup: "Fence" },
  { code: "STN-DECK", name: "Deck floor staining", category: "Staining", unit: "sqft", productionRate: "130", additionalCoatFactor: "0.85", defaultCoats: 2, material: "bm-arborcoat", proposalGroup: "Deck" },
  { code: "CAB-DOOR", name: "Cabinet door / drawer front (both sides)", category: "Cabinets", unit: "each", basis: "hours_per_unit", productionRate: "1.0", additionalCoatFactor: "0.7", defaultCoats: 2, material: "sw-cabinet", otherCostPerUnit: "1.50", proposalGroup: "Cabinets" },
  { code: "CAB-BOX", name: "Cabinet boxes / face frames", category: "Cabinets", unit: "lnft", productionRate: "4", additionalCoatFactor: "0.7", defaultCoats: 2, material: "sw-cabinet", proposalGroup: "Cabinets" },
  // Prep
  { code: "PREP-PW", name: "Pressure washing", category: "Prep", unit: "sqft", productionRate: "450", defaultCoats: 1, otherCostPerUnit: "0.01" },
  { code: "PREP-SCRAPE", name: "Scraping", category: "Prep", unit: "sqft", productionRate: "150", defaultCoats: 1 },
  { code: "PREP-SAND", name: "Sanding", category: "Prep", unit: "sqft", productionRate: "200", defaultCoats: 1, otherCostPerUnit: "0.02" },
  { code: "PREP-PRIME", name: "Spot / full priming", category: "Prep", unit: "sqft", productionRate: "220", defaultCoats: 1, material: "cl-primer" },
  { code: "PREP-CAULK", name: "Caulking", category: "Prep", unit: "lnft", productionRate: "60", defaultCoats: 1, otherCostPerUnit: "0.15" },
  // Repairs
  { code: "REP-DRYWALL-S", name: "Drywall patch – small", category: "Repairs", unit: "each", basis: "hours_per_unit", productionRate: "0.5", defaultCoats: 1, otherCostPerUnit: "3" },
  { code: "REP-DRYWALL-L", name: "Drywall patch – large", category: "Repairs", unit: "each", basis: "hours_per_unit", productionRate: "1.5", defaultCoats: 1, otherCostPerUnit: "12" },
  { code: "REP-WOODROT", name: "Wood rot repair", category: "Repairs", unit: "hour", productionRate: "1", defaultCoats: 1 },
  { code: "GEN-HOURLY", name: "General labour (hourly)", category: "General", unit: "hour", productionRate: "1", defaultCoats: 1 },
];

/**
 * Company pricing defaults. Placeholders until the owner confirms real
 * figures in Settings → Pricing.
 */
export const DEFAULT_PRICING = {
  pricingMethod: "billing_rate" as const,
  laborCostPerHour: "45.00",
  billingRatePerHour: "80.00",
  targetMargin: "0.45",
  materialMarkupPct: "0.20",
  minimumJobPrice: "2000.00",
  gstRate: "0.05",
  depositPct: "0.20",
  estimateValidDays: 30,
  hoursPerCrewDay: "8",
};

export const DEFAULT_COMPANY = {
  /** Legal name (contract, emails). */
  name: "Grandview Painting Ltd.",
  /** Shown on the proposal cover and FROM block. */
  displayName: "Grandview Painting",
  tagline: "Quality focused. Integrity driven.",
  email: "info@grandviewpainting.ca",
  phone: "",
  phone2: "",
  phone2Label: "",
  /** May contain a line break ("street\ncity, province postal code"). */
  address: "",
  gstNumber: "",
  licenceLabel: "License",
  licenceNumber: "181767",
  website: "https://www.grandviewpainting.ca/",
  bookingUrl: "",
};

/**
 * Company details as printed on the owner's Markate proposal. Only used by the
 * "Fill from your Markate proposal" button; saved when the owner presses Save.
 */
export const COMPANY_PREFILL = {
  phone: "(604) 970-4554",
  phone2: "(604) 560-8896",
  address: "3211 152 Street - Bldg 3211 C, Suite 402\nSurrey, BC V3S 3M1",
  gstNumber: "779722206",
};

export { DEFAULT_PROPOSAL_TEMPLATE, SUGGESTED_NOTES } from "./seed-proposal-template";

export const MESSAGE_TEMPLATES = [
  {
    key: "lead_booking_link",
    name: "New lead – book your estimate",
    channel: "email" as const,
    subject: "Book your free estimate with Grandview Painting",
    body: `Hi {{first_name}},

Thanks for reaching out to Grandview Painting about your {{project_types}} project.

The quickest way to get your free estimate is to pick a time that works for you here:
{{booking_url}}

If you have any questions, just reply to this email or call us at {{company_phone}}.

Thanks,
{{sender_name}}
Grandview Painting Ltd.`,
  },
  {
    key: "lead_follow_up",
    name: "Lead follow-up (no booking yet)",
    channel: "email" as const,
    subject: "Still thinking about your painting project?",
    body: `Hi {{first_name}},

Just following up on your painting inquiry. When you're ready, you can book a time for your free estimate here:
{{booking_url}}

Thanks,
{{sender_name}}
Grandview Painting Ltd.`,
  },
];

/**
 * Proposal wording. STARTING TEXT ONLY: written as a reasonable default for a
 * BC painting contractor; the owner should review it in Settings → Proposals.
 */
export const DEFAULT_PROPOSAL = {
  intro:
    "Thank you for the opportunity to quote your project. This proposal outlines the work we'll do, the products we'll use and the investment. Please review it, choose any optional upgrades, and sign below to book your project.",
  preparation:
    "All areas will be protected with drop sheets and masking. Surfaces will be cleaned and prepared as described for each area: filling minor holes and cracks, sanding, spot priming and caulking where needed. Furniture moving is limited to items that can be safely moved by two people.",
  inclusions: "All labour, paint and sundries for the areas listed\nDaily clean-up and final clean-up\nFinal walk-through with you before we finish",
  exclusions:
    "Repairs beyond normal preparation unless listed (e.g. wood rot, major drywall damage)\nMoving or disposing of heavy furniture, appliances or contents\nLead or asbestos testing and abatement\nPermits, unless listed\nAny work not described in this proposal",
  warranty:
    "Grandview Painting warrants its workmanship against peeling, blistering and flaking for 2 years from completion. The warranty excludes damage, normal wear, moisture or structural issues, and surfaces we did not prepare.",
  paymentTerms:
    "A deposit is due to book your start date. The balance is due on completion. We accept e-transfer, cheque and credit card. GST is shown separately.",
  terms:
    "This proposal is valid until the date shown. Colours and sheens are confirmed with you before work begins. Changes to the scope after acceptance are handled by written change order. Start dates depend on weather for exterior work.",
  showAreaPrices: false,
};

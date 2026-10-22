import "server-only";
/**
 * The crew-facing work order document. Pure (no database access) so the crew-safe
 * guarantee can be unit-tested: every field is copied by name from the accepted
 * estimate, the bookings and the work order. Never prices, rates or costs.
 * Quantities, coats, products and colours are shown because crews need them, and
 * labour hours and paint to buy (from crew-quantities) when the work-order settings
 * say so: the owner wants crews to see their hours, never the money (Oct 2026).
 */
import { colourLabel } from "@/lib/colours/schemas";
import { crewQuantities, hoursLabel, paintToBuy, paintToBuyLabel, type PaintNeed } from "@/lib/estimating/crew-quantities";
import { isIncluded } from "@/lib/estimating/engine";
import { resolvedQuantity, type DocArea, type DocLine, type EstimateDoc } from "@/lib/estimating/document";
import { d, Decimal, formatNum } from "@/lib/money";
import { parseProse, splitLines, type Block } from "@/lib/proposal-template/prose";
import { resolveJobType } from "@/lib/proposal-template/resolve";
import type { ProposalTemplate } from "@/lib/proposal-template/schema";
import { fillTokens } from "@/lib/proposal-template/tokens";
import type { ScheduleEntryKind } from "@/lib/schedule/constants";
import { dateRangeLabel, kindLabel } from "@/lib/schedule/format";
import { formatAddress, formatDate, mapsUrl } from "@/lib/utils";
import { lineScopes } from "./proposal-view";

export type { Block };

export interface WorkOrderScopeItem {
  title: string;
  /** "560" with unit "sq ft"; null for hourly lines (their time is in `hours`). */
  quantity: string | null;
  unit: string | null;
  coats: number | null;
  product: string | null;
  colour: string | null;
  sheen: string | null;
  detail: Block[];
  /** Estimated labour hours, "3.5". Only when hours are shown and the item takes time. */
  hours?: string;
}

/** One row of the customer's signed colour selections. */
export interface WorkOrderColour {
  room: string;
  surface: string;
  /** "SW 7008 Alabaster". */
  colour: string;
  sheen: string;
}

/** One row of "Paint to order". */
export interface WorkOrderPaint {
  product: string;
  colour: string | null;
  sheen: string | null;
  /** "3 gal", "2 gal + 1 qt"; null when nothing could be worked out. */
  amount: string | null;
  /** What the amount leaves out, e.g. "Doesn't include 1 item that wasn't measured". */
  note: string | null;
}

export interface WorkOrderBooking {
  label: string;
  /** Calendar days, "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
  /** "Mon, Oct 26 – Fri, Oct 30". */
  dates: string;
  workDays: number;
  crewName: string | null;
  crewNotes: string | null;
}

export interface WorkOrderView {
  viewVersion: 1;
  /** "WO-7001". */
  number: string;
  version: number;
  issuedOn: string;
  title: string;
  jobType: string;
  jobTypeLabel: string;
  projectNumber: number;
  customerName: string;
  /** Only when "Show customer phone to crew" is ticked. */
  customerPhone: string | null;
  address: string | null;
  mapsUrl: string | null;
  accessNotes: string | null;
  /** The property was built before 1990: crews assume lead paint and asbestos. Left out otherwise (older versions don't have it). */
  builtBefore1990?: true;
  crew: { name: string; lead: string | null } | null;
  bookings: WorkOrderBooking[];
  /** The office contact for the crew. */
  projectManager: { name: string; phone: string | null } | null;
  /** `hours` = the area's items added up, when hours are shown. */
  scope: { area: string; description: string | null; items: WorkOrderScopeItem[]; hours?: string }[];
  /** Estimated labour for the whole job, prep included, when hours are shown. */
  labourHours?: string;
  preparation: Block[];
  /** Estimated prep hours, when hours are shown and there is prep. */
  prepHours?: string;
  /** What to buy, when paint is shown (older versions don't have it). */
  paint?: WorkOrderPaint[];
  /** The customer's signed colours, when there are any. */
  colours?: WorkOrderColour[];
  excluded: string[];
  specialInstructions: Block[];
  equipment: Block[];
  safety: Block[];
  checklist: { id: string; text: string }[];
}

export interface WorkOrderInput {
  workOrder: {
    number: number;
    title: string;
    specialInstructions: string | null;
    equipment: string | null;
    safetyNotes: string | null;
    accessNotes: string | null;
    showCustomerPhone: boolean;
    checklist: readonly { id: string; text: string }[];
    /** Null = the whole project (all crews). */
    crewId: string | null;
  };
  version: number;
  issuedAt: Date;
  projectNumber: number;
  /** The accepted estimate document, with the signed options selected. */
  doc: EstimateDoc;
  template: ProposalTemplate;
  company: { name: string; displayName?: string; phone?: string };
  customer: { name: string; phone: string | null };
  property: { street: string; unit: string | null; city: string | null; province: string | null; postalCode: string | null; accessNotes: string | null; builtBefore1990?: boolean | null } | null;
  crew: { name: string; lead: string | null } | null;
  /** Labour hours and paint to order are optional extras (the work-order settings). */
  show: { hours: boolean; paint: boolean };
  /** Rows of the customer's signed colour forms; those with a lineId set that estimate line's colour and sheen. */
  colours?: readonly { room: string; surface: string; colour: string; code: string; sheen: string; lineId?: string | null }[];
  /** The project's non-deleted bookings. */
  bookings: readonly {
    kind: ScheduleEntryKind;
    phaseLabel: string | null;
    startDate: string;
    endDate: string;
    workDays: number;
    crewId: string | null;
    crewName: string | null;
    crewNotes: string | null;
  }[];
  projectManager: { name: string; phone: string | null } | null;
}

export const workOrderNumber = (n: number) => `WO-${n}`;

const UNIT: Record<string, string | null> = { sqft: "sq ft", lnft: "ln ft", each: "each", hour: null };
const p = (text: string): Block => ({ type: "p", text });
const ul = (items: string[]): Block => ({ type: "ul", items });
const isPrep = (l: DocLine) => (l.rateSnapshot.category ?? "").trim().toLowerCase() === "prep";
const clean = (s: string | null | undefined) => s?.trim() || null;

/** Hours worth showing: more than nothing. Keys are left out otherwise, so versions without hours compare equal. */
const shownHours = (h: Decimal | undefined) => (h && h.gt(0) ? { hours: hoursLabel(h) } : {});
const sum = (hs: (Decimal | undefined)[]) => hs.reduce<Decimal>((s, h) => (h ? s.plus(h) : s), new Decimal(0));

function scopeItem(l: DocLine, area: DocArea | undefined, hours: Map<string, Decimal> | null): WorkOrderScopeItem {
  const unit = UNIT[l.rateSnapshot.unit] ?? null;
  const q = unit ? d(resolvedQuantity(l, area)) : null;
  const shown = q !== null && q.gt(0);
  return {
    title: clean(l.customerDescription) ?? l.description,
    quantity: shown ? formatNum(q, 1) : null,
    unit: shown ? unit : null,
    coats: unit && l.coats > 0 ? l.coats : null,
    product: clean(l.rateSnapshot.material?.productName),
    colour: clean(l.colour),
    sheen: clean(l.sheen),
    detail: parseProse(l.customerDetail),
    ...(hours ? shownHours(hours.get(l.id)) : {}),
  };
}

function buildScope(doc: EstimateDoc, hours: Map<string, Decimal> | null): WorkOrderView["scope"] {
  const areas = new Map(doc.areas.map((a) => [a.id, a]));
  const name = (a: DocArea) => {
    const parent = a.parentId ? areas.get(a.parentId) : undefined;
    return parent ? `${parent.name} › ${a.name}` : a.name;
  };
  const lines = doc.lines.filter((l) => isIncluded(l) && !isPrep(l));
  const group = (area: string, description: string | null, ls: DocLine[], a: DocArea | undefined) => ({
    area,
    description,
    items: ls.map((l) => scopeItem(l, a, hours)),
    ...(hours ? shownHours(sum(ls.map((l) => hours.get(l.id)))) : {}),
  });
  const out: WorkOrderView["scope"] = [];
  for (const a of doc.areas) {
    const ls = lines.filter((l) => l.areaId === a.id);
    if (ls.length) out.push(group(name(a), clean(a.customerDescription), ls, a));
  }
  const loose = lines.filter((l) => !l.areaId || !areas.has(l.areaId));
  if (loose.length) out.push(group("General", null, loose, undefined));
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function paintRow(p: PaintNeed): WorkOrderPaint {
  const left = [
    p.noQuantity.length ? plural(p.noQuantity.length, "item that wasn't measured", "items that weren't measured") : null,
    p.noCoverage.length ? `${plural(p.noCoverage.length, "item", "items")} with no coverage on file for this product` : null,
  ].filter((x): x is string => !!x);
  const amount = p.gallons.gt(0) ? paintToBuyLabel(paintToBuy(p.gallons)) : null;
  return {
    product: p.product,
    colour: p.colour,
    sheen: p.sheen,
    amount,
    note: left.length ? `${amount ? "Doesn't include" : "Not worked out:"} ${left.join(" and ")}. Ask the office.` : null,
  };
}

function buildPreparation(doc: EstimateDoc, tpl: ProposalTemplate, company: WorkOrderInput["company"]): Block[] {
  const resolved = resolveJobType(tpl, doc.jobType, lineScopes(doc));
  const values = { companyName: (company.displayName || company.name || "").trim(), companyPhone: (company.phone ?? "").trim() };
  // Proposal tokens the crew view has no value for are dropped rather than shown as {token}.
  const fill = (s: string) => fillTokens(s, values).replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, "");
  const blocks = resolved.preparation.map((b, i) => ({ title: b.title, body: i === 0 && doc.preparationOverride != null ? doc.preparationOverride : b.body }));
  if (!blocks.length && doc.preparationOverride) blocks.push({ title: "Preparation", body: doc.preparationOverride });
  const out: Block[] = [];
  for (const b of blocks) {
    if (blocks.length > 1 && b.title.trim()) out.push(p(fill(b.title)));
    out.push(...parseProse(fill(b.body)));
  }
  const prepItems = doc.lines.filter((l) => isIncluded(l) && isPrep(l)).flatMap((l) => (l.customerDetail?.trim() ? splitLines(l.customerDetail) : [clean(l.customerDescription) ?? l.description]));
  if (prepItems.length) out.push(ul(prepItems));
  return out;
}

/** The signed colours win over whatever the estimate said, line by line. */
function withSignedColours(doc: EstimateDoc, colours: NonNullable<WorkOrderInput["colours"]>): EstimateDoc {
  const byLine = new Map(colours.filter((c) => c.lineId && (c.colour || c.code)).map((c) => [c.lineId!, c]));
  if (!byLine.size) return doc;
  return {
    ...doc,
    lines: doc.lines.map((l) => {
      const c = byLine.get(l.id);
      return c ? { ...l, colour: colourLabel(c), sheen: c.sheen || l.sheen } : l;
    }),
  };
}

export function buildWorkOrderView(input: WorkOrderInput): WorkOrderView {
  const { workOrder: wo, show } = input;
  const colours = (input.colours ?? []).filter((c) => c.colour || c.code);
  const doc = withSignedColours(input.doc, colours);
  const q = show.hours || show.paint ? crewQuantities(doc) : null;
  const hours = show.hours && q ? q.lineHours : null;
  const prepHours = hours ? sum(doc.lines.filter((l) => isIncluded(l) && isPrep(l)).map((l) => hours.get(l.id))) : null;
  const resolved = resolveJobType(input.template, doc.jobType, lineScopes(doc));
  const address = input.property?.street
    ? formatAddress({ street: input.property.street, unit: input.property.unit, city: input.property.city, province: input.property.province, postalCode: input.property.postalCode })
    : null;
  const bookings = input.bookings
    .filter((b) => !wo.crewId || b.crewId === wo.crewId)
    .slice()
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))
    .map((b) => ({
      label: b.phaseLabel?.trim() ? `${kindLabel(b.kind)} – ${b.phaseLabel.trim()}` : kindLabel(b.kind),
      startDate: b.startDate,
      endDate: b.endDate,
      dates: dateRangeLabel(b.startDate, b.endDate),
      workDays: b.workDays,
      crewName: b.crewName,
      crewNotes: clean(b.crewNotes),
    }));
  return {
    viewVersion: 1,
    number: workOrderNumber(wo.number),
    version: input.version,
    issuedOn: formatDate(input.issuedAt),
    title: wo.title.trim() || doc.title,
    jobType: doc.jobType,
    jobTypeLabel: resolved.label,
    projectNumber: input.projectNumber,
    customerName: input.customer.name,
    customerPhone: wo.showCustomerPhone ? clean(input.customer.phone) : null,
    address,
    mapsUrl: address ? mapsUrl(address) : null,
    accessNotes: clean(wo.accessNotes) ?? clean(input.property?.accessNotes),
    ...(input.property?.builtBefore1990 ? { builtBefore1990: true as const } : {}),
    crew: input.crew ? { name: input.crew.name, lead: input.crew.lead } : null,
    bookings,
    projectManager: input.projectManager ? { name: input.projectManager.name, phone: clean(input.projectManager.phone) } : null,
    scope: buildScope(doc, hours),
    ...(hours && q && q.jobHours.gt(0) ? { labourHours: hoursLabel(q.jobHours) } : {}),
    preparation: buildPreparation(doc, input.template, input.company),
    ...(prepHours && prepHours.gt(0) ? { prepHours: hoursLabel(prepHours) } : {}),
    ...(show.paint && q ? { paint: q.paint.map(paintRow) } : {}),
    ...(colours.length ? { colours: colours.map((c) => ({ room: c.room, surface: c.surface, colour: colourLabel(c), sheen: c.sheen })) } : {}),
    excluded: splitLines(doc.areasExcluded ?? resolved.areasExcludedDefault),
    specialInstructions: parseProse(wo.specialInstructions),
    equipment: parseProse(wo.equipment),
    safety: parseProse(wo.safetyNotes),
    checklist: wo.checklist.map((c) => ({ id: c.id, text: c.text })),
  };
}

export const WORK_ORDER_SECTIONS = ["details", "bookings", "access", "scope", "colours", "paint", "preparation", "excluded", "specialInstructions", "equipment", "safety", "checklist"] as const;
export type WorkOrderSection = (typeof WORK_ORDER_SECTIONS)[number];

function sectionValue(v: WorkOrderView, s: WorkOrderSection): unknown {
  switch (s) {
    // The pre-1990 warning shows at the top of the job details.
    case "details":
      return [v.title, v.customerName, v.customerPhone, v.crew, v.projectManager, v.builtBefore1990 ?? false];
    case "access":
      return [v.address, v.accessNotes];
    // Versions issued before hours and paint existed have no such keys: compare them as "none".
    case "scope":
      return [v.scope, v.labourHours ?? null];
    case "preparation":
      return [v.preparation, v.prepHours ?? null];
    case "paint":
      return v.paint ?? [];
    case "colours":
      return v.colours ?? [];
    default:
      return v[s];
  }
}

/** JSON with object keys sorted: Postgres jsonb reorders keys, so a stored view must still equal a freshly built one. */
function stableJson(v: unknown): string {
  return JSON.stringify(v, (_key, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
}

/** Sections that differ between two issued versions (for the "Changed" highlight); none without a previous version. */
export function changedSections(prev: WorkOrderView | null | undefined, next: WorkOrderView): WorkOrderSection[] {
  if (!prev) return [];
  return WORK_ORDER_SECTIONS.filter((s) => stableJson(sectionValue(prev, s)) !== stableJson(sectionValue(next, s)));
}

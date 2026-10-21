import "server-only";
/**
 * The crew-facing work order document. Pure (no database access) so the crew-safe
 * guarantee can be unit-tested: every field is copied by name from the accepted
 * estimate, the bookings and the work order. Never prices, rates, costs or hours;
 * quantities, coats, products and colours are shown because crews need them.
 */
import { isIncluded } from "@/lib/estimating/engine";
import { resolvedQuantity, type DocArea, type DocLine, type EstimateDoc } from "@/lib/estimating/document";
import { d, formatNum } from "@/lib/money";
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
  /** "560" with unit "sq ft"; null for hourly lines (hours are never shown). */
  quantity: string | null;
  unit: string | null;
  coats: number | null;
  product: string | null;
  colour: string | null;
  sheen: string | null;
  detail: Block[];
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
  crew: { name: string; lead: string | null } | null;
  bookings: WorkOrderBooking[];
  /** The office contact for the crew. */
  projectManager: { name: string; phone: string | null } | null;
  scope: { area: string; description: string | null; items: WorkOrderScopeItem[] }[];
  preparation: Block[];
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
  property: { street: string; unit: string | null; city: string | null; province: string | null; postalCode: string | null; accessNotes: string | null } | null;
  crew: { name: string; lead: string | null } | null;
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

function scopeItem(l: DocLine, area: DocArea | undefined): WorkOrderScopeItem {
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
  };
}

function buildScope(doc: EstimateDoc): WorkOrderView["scope"] {
  const areas = new Map(doc.areas.map((a) => [a.id, a]));
  const name = (a: DocArea) => {
    const parent = a.parentId ? areas.get(a.parentId) : undefined;
    return parent ? `${parent.name} › ${a.name}` : a.name;
  };
  const lines = doc.lines.filter((l) => isIncluded(l) && !isPrep(l));
  const out: WorkOrderView["scope"] = [];
  for (const a of doc.areas) {
    const items = lines.filter((l) => l.areaId === a.id).map((l) => scopeItem(l, a));
    if (items.length) out.push({ area: name(a), description: clean(a.customerDescription), items });
  }
  const loose = lines.filter((l) => !l.areaId || !areas.has(l.areaId)).map((l) => scopeItem(l, undefined));
  if (loose.length) out.push({ area: "General", description: null, items: loose });
  return out;
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

export function buildWorkOrderView(input: WorkOrderInput): WorkOrderView {
  const { doc, workOrder: wo } = input;
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
    crew: input.crew ? { name: input.crew.name, lead: input.crew.lead } : null,
    bookings,
    projectManager: input.projectManager ? { name: input.projectManager.name, phone: clean(input.projectManager.phone) } : null,
    scope: buildScope(doc),
    preparation: buildPreparation(doc, input.template, input.company),
    excluded: splitLines(doc.areasExcluded ?? resolved.areasExcludedDefault),
    specialInstructions: parseProse(wo.specialInstructions),
    equipment: parseProse(wo.equipment),
    safety: parseProse(wo.safetyNotes),
    checklist: wo.checklist.map((c) => ({ id: c.id, text: c.text })),
  };
}

export const WORK_ORDER_SECTIONS = ["details", "bookings", "access", "scope", "preparation", "excluded", "specialInstructions", "equipment", "safety", "checklist"] as const;
export type WorkOrderSection = (typeof WORK_ORDER_SECTIONS)[number];

function sectionValue(v: WorkOrderView, s: WorkOrderSection): unknown {
  switch (s) {
    case "details":
      return [v.title, v.customerName, v.customerPhone, v.crew, v.projectManager];
    case "access":
      return [v.address, v.accessNotes];
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

import "server-only";
/**
 * The frozen, customer-facing proposal document. Pure (no database access) so the
 * customer-safe guarantee can be unit-tested: every field is copied by name, never
 * by spreading an estimate, line, rate snapshot or settings object.
 */
import { DEFAULT_PROPOSAL_TEMPLATE } from "@/db/seed-proposal-template";
import { calculateDoc, type DocLine, type EstimateDoc } from "@/lib/estimating/document";
import { d, Decimal, formatCAD } from "@/lib/money";
import { parseProse, splitLines, type Block } from "@/lib/proposal-template/prose";
import { appliesToScopes, clauseText, resolveJobType, scopeFromCategory, type ResolvedJobType } from "@/lib/proposal-template/resolve";
import type { ProposalTemplate, Scope } from "@/lib/proposal-template/schema";
import { fillTokens, type TokenValues } from "@/lib/proposal-template/tokens";
import { formatDate } from "@/lib/utils";

export type { Block };

/** The first view format (proposals sent before the presentation template). Still stored on old rows. */
export interface ProposalViewV1 {
  number: number;
  revision: number;
  title: string;
  customerName: string;
  contactName: string | null;
  address: string | null;
  issuedOn: string;
  validUntil: string | null;
  company: { name: string; phone: string; email: string; address: string; gstNumber: string };
  intro: string;
  message: string | null;
  customerNotes: string | null;
  showAreaPrices: boolean;
  areas: { id: string; name: string; price: string | null; items: { id: string; title: string; detail: string }[] }[];
  options: { id: string; title: string; area: string | null; price: string; recommended: boolean }[];
  products: { name: string; colours: string[] }[];
  gstRate: string;
  depositPct: string;
  sections: { preparation: string; inclusions: string[]; exclusions: string[]; warranty: string; paymentTerms: string; terms: string };
}
/** Kept for older imports: the v1 shape. */
export type ProposalView = ProposalViewV1;

export type ServiceLineKind = "preparation" | "option" | "areas" | "excluded" | "paint" | "item" | "notes" | "services";

export interface ServiceLine {
  no: number;
  kind: ServiceLineKind;
  title: string;
  blocks: Block[];
  optionId?: string;
  price?: string;
  recommended?: boolean;
  areaName?: string | null;
}

export interface ProposalOption {
  id: string;
  title: string;
  detail: Block[];
  area: string | null;
  price: string;
  recommended: boolean;
  lineNo: number;
}

export interface ProposalCompany {
  displayName: string;
  legalName: string;
  licenceLabel: string;
  licenceNumber: string;
  gstNumber: string;
  addressLines: string[];
  email: string;
  phones: { label: string; number: string; tel: string }[];
  website: string;
}

type Titled<T> = { title: string } & T;

export interface ProposalContract {
  banner: { title: string; subtitle: string };
  intro: Block[];
  scopeOfWork: Titled<{ blocks: Block[] }>;
  terms: Titled<{ items: string[] }>;
  warranty: Titled<{
    months: number;
    intro: Block[];
    conditions: string[];
    exclusionsLeadIn: string;
    exclusions: { text: string; note?: string; children: string[] }[];
    closing: Block[];
  }>;
  quality: Titled<{ items: string[] }>;
  paints: Titled<{ items: { text: string; emphasis: boolean }[] }>;
  unforeseen: Titled<{ blocks: Block[] }>;
  customerResponsibility: Titled<{ items: string[] }>;
  insurance: Titled<{ blocks: Block[] }>;
  acceptance: Titled<{ items: string[] }>;
  payment: Titled<{ items: string[] }>;
}

export type ProposalLabels = ProposalTemplate["estimateDocument"]["labels"] & { documentTitle: string; services: string };

export interface ProposalViewV2 {
  viewVersion: 2;
  /** "v1" when converted at render time from a proposal sent before v2. */
  legacy?: boolean;
  number: number;
  displayNumber: string;
  revision: number;
  title: string;
  jobType: string;
  jobTypeLabel: string;
  scopes: Scope[];
  firstName: string | null;
  customerName: string;
  contactName: string | null;
  customerPhone: string | null;
  jobAddress: string | null;
  poNumber: string | null;
  issuedOn: string;
  validUntil: string | null;
  company: ProposalCompany;
  message: string;
  labels: ProposalLabels;
  lines: ServiceLine[];
  options: ProposalOption[];
  showTaxLine: boolean;
  showAreaPrices: boolean;
  gstRate: string;
  depositPct: string;
  paymentMethods: string[];
  footerNotes: string[];
  contract: ProposalContract;
}

/** Company settings as stored (`company` key); only these fields are read. */
export interface CompanyInput {
  name: string;
  displayName?: string;
  email?: string;
  phone?: string;
  phone2?: string;
  phone2Label?: string;
  address?: string;
  gstNumber?: string;
  licenceLabel?: string;
  licenceNumber?: string;
  website?: string;
}

export function telHref(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return digits ? `tel:${digits}` : "";
}

export function companyBlock(c: CompanyInput): ProposalCompany {
  const phones = [
    { label: "", number: (c.phone ?? "").trim() },
    { label: (c.phone2Label ?? "").trim(), number: (c.phone2 ?? "").trim() },
  ]
    .filter((p) => p.number)
    .map((p) => ({ ...p, tel: telHref(p.number) }));
  return {
    displayName: (c.displayName || c.name || "").trim(),
    legalName: (c.name || "").trim(),
    licenceLabel: (c.licenceLabel ?? "").trim(),
    licenceNumber: (c.licenceNumber ?? "").trim(),
    gstNumber: (c.gstNumber ?? "").trim(),
    addressLines: splitLines(c.address),
    email: (c.email ?? "").trim(),
    phones,
    website: (c.website ?? "").trim(),
  };
}

/** "0.20" → "20" (for wording such as "a 20% deposit"). */
export function percentText(fraction: string): string {
  return d(fraction).times(100).toDecimalPlaces(2).toString();
}

const NON_PAINT = new Set(["prep", "repairs", "general"]);
const category = (l: DocLine) => (l.rateSnapshot.category ?? "").trim().toLowerCase();
const groupLabel = (l: DocLine) => l.rateSnapshot.proposalGroup?.trim() || l.rateSnapshot.customerLabel?.trim() || l.rateSnapshot.name.split(" – ")[0].trim();
const isPaintLine = (l: DocLine) => !NON_PAINT.has(category(l)) && !(l.rateSnapshot.unit === "hour" && !l.rateSnapshot.proposalGroup);

/** Scopes implied by the estimate's lines (rate categories). */
export function lineScopes(doc: EstimateDoc): Scope[] {
  const s = new Set<Scope>();
  for (const l of doc.lines) {
    const scope = scopeFromCategory(l.rateSnapshot.category);
    if (scope) s.add(scope);
  }
  return [...s];
}

const p = (text: string): Block => ({ type: "p", text });
const ul = (items: string[]): Block => ({ type: "ul", items });

/** Numbered service lines, in Markate's order. */
export function buildServiceLines(doc: EstimateDoc, tpl: ProposalTemplate, resolved: ResolvedJobType, values: TokenValues): { lines: ServiceLine[]; options: ProposalOption[] } {
  const ed = tpl.estimateDocument;
  const result = calculateDoc(doc);
  const linePrice = new Map(result.lines.map((r) => [r.id, r.price]));
  const costPrice = new Map(result.costItems.map((r) => [r.id, r.price]));
  const areaById = new Map(doc.areas.map((a) => [a.id, a]));
  const areaName = (id: string | null | undefined) => (id ? (areaById.get(id)?.name ?? null) : null);
  const fill = (s: string, extra: TokenValues = {}) => fillTokens(s, { ...values, ...extra });

  const out: Omit<ServiceLine, "no">[] = [];
  const options: Omit<ProposalOption, "lineNo">[] = [];

  // 1. Preparation (prep lines themselves are never listed; their price stays in the total).
  const prepDetails = doc.lines
    .filter((l) => !l.isOptional && category(l) === "prep" && l.customerDetail)
    .flatMap((l) => splitLines(l.customerDetail));
  const prep = resolved.preparation.map((b, i) => ({
    title: b.title,
    body: i === 0 && doc.preparationOverride != null ? doc.preparationOverride : b.body,
  }));
  if (!prep.length && (doc.preparationOverride || prepDetails.length)) prep.push({ title: "Preparation", body: doc.preparationOverride ?? "" });
  prep.forEach((b, i) => {
    const blocks = parseProse(fill(b.body));
    if (i === 0 && prepDetails.length) blocks.push(ul(prepDetails));
    out.push({ kind: "preparation", title: fill(b.title), blocks });
  });

  // 2. Optional upgrades, priced by the engine.
  for (const l of doc.lines.filter((x) => x.isOptional)) {
    const detail = parseProse(l.customerDetail);
    const colour = [l.colour, l.sheen].filter(Boolean).join(", ");
    if (colour) detail.push(p(`Colour: ${colour}`));
    const price = (linePrice.get(l.id) ?? new Decimal(0)).toFixed(2);
    const title = fill(ed.optionTitle, { title: l.customerDescription || l.description });
    options.push({ id: l.id, title, detail, area: areaName(l.areaId), price, recommended: l.optionSelected });
    out.push({ kind: "option", title, blocks: detail, optionId: l.id, price, recommended: l.optionSelected, areaName: areaName(l.areaId) });
  }
  for (const c of doc.costItems.filter((x) => x.isOptional)) {
    const price = (costPrice.get(c.id) ?? new Decimal(0)).toFixed(2);
    const title = fill(ed.optionTitle, { title: c.customerDescription || c.description });
    options.push({ id: c.id, title, detail: [], area: null, price, recommended: c.optionSelected });
    out.push({ kind: "option", title, blocks: [], optionId: c.id, price, recommended: c.optionSelected, areaName: null });
  }

  // 3. Areas to be painted.
  const paint = doc.lines.filter((l) => !l.isOptional && isPaintLine(l));
  const bullets: string[] = [];
  const groupsOf = (ls: DocLine[]) => [...new Set(ls.map(groupLabel))];
  if (resolved.areasListMode === "areas") {
    for (const a of doc.areas) {
      if (!paint.some((l) => l.areaId === a.id)) continue;
      const name = a.customerDescription?.trim() ? `${a.name}: ${a.customerDescription.trim()}` : a.name;
      if (ed.showAreaPrices) {
        const total = doc.lines.filter((l) => !l.isOptional && l.areaId === a.id).reduce((s, l) => s.plus(linePrice.get(l.id) ?? 0), new Decimal(0));
        bullets.push(`${name} – ${formatCAD(total)}`);
      } else bullets.push(name);
    }
    bullets.push(...groupsOf(paint.filter((l) => !l.areaId || !areaById.has(l.areaId))));
  } else bullets.push(...groupsOf(paint));
  let areasLineIndex: number | null = null;
  if (bullets.length) {
    areasLineIndex = out.length;
    out.push({ kind: "areas", title: fill(ed.areasToBePainted.title), blocks: [...(ed.areasToBePainted.leadIn ? [p(fill(ed.areasToBePainted.leadIn))] : []), ul(bullets)] });
  }

  // 4. Areas to be excluded (skipped when empty). The closing names the real line number.
  const excluded = splitLines(doc.areasExcluded ?? resolved.areasExcludedDefault);
  if (excluded.length) {
    const blocks: Block[] = [...(ed.areasToBeExcluded.leadIn ? [p(fill(ed.areasToBeExcluded.leadIn))] : []), ul(excluded)];
    if (areasLineIndex !== null && ed.areasToBeExcluded.closing) blocks.push(p(fill(ed.areasToBeExcluded.closing, { areasLineNo: areasLineIndex + 1 })));
    out.push({ kind: "excluded", title: fill(ed.areasToBeExcluded.title), blocks });
  }

  // 5. Paint {surface}: grouped by surface, product and coats.
  const paintAreas = new Set(paint.map((l) => (l.areaId && areaById.has(l.areaId) ? l.areaId : "")));
  const groups = new Map<string, { label: string; product: string | null; coats: number; lines: DocLine[] }>();
  for (const l of paint) {
    const label = groupLabel(l);
    const product = l.rateSnapshot.material?.productName?.trim() || null;
    const key = JSON.stringify([label.toLowerCase(), product, l.coats]);
    const g = groups.get(key) ?? { label, product, coats: l.coats, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const lower = g.label.toLowerCase();
    const areas = new Set(g.lines.map((l) => (l.areaId && areaById.has(l.areaId) ? l.areaId : "")));
    const named = doc.areas.filter((a) => areas.has(a.id)).map((a) => a.name);
    const target = [...paintAreas].every((a) => areas.has(a)) || !named.length ? `all ${lower}` : `${lower} in ${named.join(", ")}`;
    const coats = g.coats > 0 ? `Apply ${g.coats} coat${g.coats === 1 ? "" : "s"}` : "Apply";
    const blocks: Block[] = [p(g.product ? `${coats}, ${g.product} to ${target}` : `${coats} to ${target}`)];
    const colours = [...new Set(g.lines.map((l) => [l.colour, l.sheen].filter(Boolean).join(", ")).filter(Boolean))];
    if (colours.length) blocks.push(p(`Colour: ${colours.join("; ")}`));
    out.push({ kind: "paint", title: fill(ed.paintLineTitle, { surface: g.label }), blocks });
  }

  // 6. Repairs, general labour, and cost items the estimator chose to describe.
  for (const l of doc.lines.filter((x) => !x.isOptional && !isPaintLine(x) && category(x) !== "prep")) {
    out.push({ kind: "item", title: l.customerDescription || l.description, blocks: parseProse(l.customerDetail), areaName: areaName(l.areaId) });
  }
  for (const c of doc.costItems.filter((x) => !x.isOptional && x.customerDescription?.trim())) {
    out.push({ kind: "item", title: c.customerDescription!.trim(), blocks: [] });
  }

  // 7. Notes for the customer.
  if (doc.customerNotes?.trim()) out.push({ kind: "notes", title: "Notes", blocks: parseProse(doc.customerNotes) });

  // 8. Services include.
  out.push({ kind: "services", title: fill(resolved.servicesInclude.title), blocks: parseProse(fill(resolved.servicesInclude.body)) });

  const lines = out.map((l, i) => ({ no: i + 1, ...l }));
  const lineNoOf = new Map(lines.filter((l) => l.optionId).map((l) => [l.optionId!, l.no]));
  return { lines, options: options.map((o) => ({ ...o, lineNo: lineNoOf.get(o.id) ?? 0 })) };
}

export function buildContract(tpl: ProposalTemplate, resolved: ResolvedJobType, values: TokenValues): ProposalContract {
  const c = tpl.contract;
  const scopes = resolved.scopes;
  const fill = (s: string, extra: TokenValues = {}) => fillTokens(s, { ...values, ...extra });
  const inScope = <T extends { appliesTo?: "all" | "interior" | "exterior" }>(items: T[]) => items.filter((i) => appliesToScopes(i.appliesTo, scopes));
  return {
    banner: { title: c.banner.title, subtitle: c.banner.subtitle },
    intro: parseProse(fill(c.intro)),
    scopeOfWork: { title: c.scopeOfWork.title, blocks: parseProse(fill(c.scopeOfWork.body)) },
    terms: { title: c.termsTitle, items: inScope(c.clauses).map((x) => fill(clauseText(x, scopes), { colourConsultFee: c.values.colourConsultFee })) },
    warranty: {
      title: c.warranty.title,
      months: resolved.warrantyMonths,
      intro: parseProse(fill(c.warranty.intro, { warrantyMonths: resolved.warrantyMonths })),
      conditions: c.warranty.conditions.map((x) => fill(x)),
      exclusionsLeadIn: fill(c.warranty.exclusionsLeadIn),
      exclusions: inScope(c.warranty.exclusions).map((x) => ({ text: fill(x.text), ...(x.note ? { note: fill(x.note) } : {}), children: x.children.map((y) => fill(y)) })),
      closing: parseProse(fill(c.warranty.closing)),
    },
    quality: { title: c.qualityStandards.title, items: inScope(c.qualityStandards.items).map((x) => fill(clauseText(x, scopes), { pcaStandardsUrl: tpl.links.pcaStandards })) },
    paints: { title: c.paintsMaterials.title, items: inScope(c.paintsMaterials.items).map((x) => ({ text: fill(clauseText(x, scopes)), emphasis: x.emphasis })) },
    unforeseen: { title: c.unforeseen.title, blocks: parseProse(fill(c.unforeseen.body)) },
    customerResponsibility: { title: c.customerResponsibility.title, items: inScope(c.customerResponsibility.items).map((x) => fill(clauseText(x, scopes))) },
    insurance: { title: c.insurance.title, blocks: parseProse(fill(c.insurance.body)) },
    acceptance: { title: c.acceptance.title, items: c.acceptance.items.map((x) => fill(x)) },
    payment: { title: c.payment.title, items: c.payment.items.map((x) => fill(x)) },
  };
}

export interface BuildViewInput {
  doc: EstimateDoc;
  number: number;
  revision: number;
  customer: { name: string; firstName: string | null; contactName: string | null; phone: string | null };
  jobAddress: string | null;
  validUntil: Date | null;
  issuedAt?: Date;
  company: CompanyInput;
  template: ProposalTemplate;
  /** The personal message typed when sending; falls back to the template's default message. */
  message: string | null;
}

export function buildProposalView(input: BuildViewInput): ProposalViewV2 {
  const { doc, template: tpl } = input;
  const ed = tpl.estimateDocument;
  const company = companyBlock(input.company);
  const resolved = resolveJobType(tpl, doc.jobType, lineScopes(doc));
  const depositPct = percentText(doc.settings.depositPct);
  const values: TokenValues = { companyName: company.displayName, companyPhone: company.phones[0]?.number ?? "", depositPct };
  const { lines, options } = buildServiceLines(doc, tpl, resolved, values);
  const message = input.message?.trim() || fillTokens(ed.defaultMessage, values);
  return {
    viewVersion: 2,
    number: input.number,
    displayNumber: `${ed.numberPrefix}${input.number}`,
    revision: input.revision,
    title: doc.title,
    jobType: doc.jobType,
    jobTypeLabel: resolved.label,
    scopes: resolved.scopes,
    firstName: input.customer.firstName?.trim() || null,
    customerName: input.customer.name,
    contactName: input.customer.contactName,
    customerPhone: input.customer.phone?.trim() || null,
    jobAddress: input.jobAddress,
    poNumber: doc.poNumber?.trim() || null,
    issuedOn: formatDate(input.issuedAt ?? new Date()),
    validUntil: input.validUntil ? formatDate(input.validUntil) : null,
    company,
    message,
    labels: { ...ed.labels, documentTitle: ed.documentTitle, services: ed.labels.services },
    lines,
    options,
    showTaxLine: ed.showTaxLine,
    showAreaPrices: ed.showAreaPrices,
    gstRate: doc.settings.gstRate,
    depositPct: doc.settings.depositPct,
    paymentMethods: [...ed.paymentMethods],
    footerNotes: ed.footerNotes.map((n) => fillTokens(n, values)),
    contract: buildContract(tpl, resolved, values),
  };
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Any stored view → v2 for rendering. v2 is returned as-is; v1 (sent before the
 * presentation template) is mapped. The stored row and its hash are never rewritten.
 */
export function normalizeView(raw: unknown, fallbackJobType: string, tpl: ProposalTemplate = DEFAULT_PROPOSAL_TEMPLATE): ProposalViewV2 {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<ProposalViewV2> & Partial<ProposalViewV1>;
  if (v.viewVersion === 2) return v as ProposalViewV2;

  const ed = tpl.estimateDocument;
  const resolved = resolveJobType(tpl, fallbackJobType);
  const lines: Omit<ServiceLine, "no">[] = [];
  const areas = arr<ProposalViewV1["areas"][number]>(v.areas);
  if (areas.length) {
    lines.push({
      kind: "areas",
      title: ed.areasToBePainted.title,
      blocks: [ul(areas.map((a) => (a.price ? `${str(a.name)} – ${formatCAD(a.price)}` : str(a.name))))],
    });
    for (const a of areas) {
      lines.push({
        kind: "item",
        title: str(a.name),
        blocks: [ul(arr<{ title: string; detail: string }>(a.items).map((i) => [str(i.title), str(i.detail)].filter(Boolean).join(" – ")))],
        areaName: str(a.name),
      });
    }
  }
  const optionsV1 = arr<ProposalViewV1["options"][number]>(v.options);
  for (const o of optionsV1) {
    lines.push({ kind: "option", title: str(o.title), blocks: [], optionId: o.id, price: str(o.price, "0.00"), recommended: !!o.recommended, areaName: o.area ?? null });
  }
  const products = arr<ProposalViewV1["products"][number]>(v.products);
  if (products.length) {
    lines.push({ kind: "item", title: "Products & colours", blocks: [ul(products.map((x) => (x.colours?.length ? `${x.name} – ${x.colours.join("; ")}` : str(x.name))))] });
  }
  if (v.customerNotes) lines.push({ kind: "notes", title: "Notes", blocks: parseProse(v.customerNotes) });
  const numbered = lines.map((l, i) => ({ no: i + 1, ...l }));

  const s = (v.sections ?? {}) as Partial<ProposalViewV1["sections"]>;
  const scopeBlocks: Block[] = [...parseProse(s.preparation)];
  if (arr<string>(s.inclusions).length) scopeBlocks.push(p("Included:"), ul(arr<string>(s.inclusions)));
  if (arr<string>(s.exclusions).length) scopeBlocks.push(p("Not included:"), ul(arr<string>(s.exclusions)));
  const c = (v.company ?? {}) as Partial<ProposalViewV1["company"]>;
  const empty = { title: "", items: [] as string[] };

  return {
    viewVersion: 2,
    legacy: true,
    number: Number(v.number ?? 0),
    displayNumber: `${ed.numberPrefix}${v.number ?? ""}`,
    revision: Number(v.revision ?? 0),
    title: str(v.title),
    jobType: fallbackJobType,
    jobTypeLabel: resolved.label,
    scopes: resolved.scopes,
    firstName: v.contactName?.split(" ")[0] || null,
    customerName: str(v.customerName),
    contactName: v.contactName ?? null,
    customerPhone: null,
    jobAddress: v.address ?? null,
    poNumber: null,
    issuedOn: str(v.issuedOn),
    validUntil: v.validUntil ?? null,
    company: companyBlock({ name: str(c.name), email: c.email, phone: c.phone, address: c.address, gstNumber: c.gstNumber }),
    message: [v.message, v.intro].filter(Boolean).join("\n\n"),
    labels: { ...ed.labels, documentTitle: ed.documentTitle, services: ed.labels.services },
    lines: numbered,
    options: optionsV1.map((o) => ({
      id: o.id,
      title: str(o.title),
      detail: [],
      area: o.area ?? null,
      price: str(o.price, "0.00"),
      recommended: !!o.recommended,
      lineNo: numbered.find((l) => l.optionId === o.id)?.no ?? 0,
    })),
    showTaxLine: true,
    showAreaPrices: !!v.showAreaPrices,
    gstRate: str(v.gstRate, "0.05"),
    depositPct: str(v.depositPct, "0"),
    paymentMethods: [],
    footerNotes: [],
    contract: {
      banner: { title: tpl.contract.banner.title, subtitle: tpl.contract.banner.subtitle },
      intro: [],
      scopeOfWork: { title: "Scope of work", blocks: scopeBlocks },
      terms: { title: "Terms", items: s.terms ? [s.terms] : [] },
      warranty: { title: "Warranty", months: 0, intro: parseProse(s.warranty), conditions: [], exclusionsLeadIn: "", exclusions: [], closing: [] },
      quality: empty,
      paints: { title: "", items: [] },
      unforeseen: { title: "", blocks: [] },
      customerResponsibility: empty,
      insurance: { title: "", blocks: [] },
      acceptance: empty,
      payment: { title: "Payment", items: s.paymentTerms ? [s.paymentTerms] : [] },
    },
  };
}

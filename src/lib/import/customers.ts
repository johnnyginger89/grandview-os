/**
 * Customer import planning (Markate and other CRM exports). Pure: given the parsed
 * file, the column mapping and an index of existing customers, decide what to create,
 * what to merge and what to skip. Nothing is written here; the preview shows the plan.
 */
import type { CsvTable } from "@/lib/csv";

export const IMPORT_FIELDS = [
  { key: "custom", label: "Keep as extra detail" },
  { key: "ignore", label: "Don't import" },
  { key: "externalId", label: "Markate customer ID" },
  { key: "displayName", label: "Customer name" },
  { key: "company", label: "Company name" },
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "fullName", label: "Contact full name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "phone2", label: "Mobile / second phone" },
  { key: "street", label: "Street address" },
  { key: "unit", label: "Unit / suite" },
  { key: "city", label: "City" },
  { key: "province", label: "Province" },
  { key: "postalCode", label: "Postal code" },
  { key: "fullAddress", label: "Full address (street, city, province, postal code)" },
  { key: "type", label: "Customer type" },
  { key: "source", label: "Lead source" },
  { key: "tags", label: "Tags" },
  { key: "notes", label: "Notes" },
  { key: "contact2Name", label: "2nd contact name" },
  { key: "contact2Email", label: "2nd contact email" },
  { key: "contact2Phone", label: "2nd contact phone" },
  { key: "contact3Name", label: "3rd contact name" },
  { key: "contact3Email", label: "3rd contact email" },
  { key: "contact3Phone", label: "3rd contact phone" },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
export const IMPORT_FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key) as [ImportField, ...ImportField[]];

/** Fields several columns may feed (their values are joined). */
const MULTI: ImportField[] = ["custom", "ignore", "notes", "tags"];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const RULES: [RegExp, ImportField][] = [
  [/^(markate )?(customer|client) (id|number|no|#)$|^(markate )?id$/, "externalId"],
  [/(additional|other|secondary|second|2nd|alt|alternate) contact.*e ?mail/, "contact2Email"],
  [/(additional|other|secondary|second|2nd|alt|alternate) contact.*(phone|mobile|cell)/, "contact2Phone"],
  [/(additional|other|secondary|second|2nd|alt|alternate) contact/, "contact2Name"],
  [/^(display name|customer name|customer|client name|client|name)$/, "displayName"],
  [/company|business|organi[sz]ation/, "company"],
  [/first name|firstname|given name/, "firstName"],
  [/last name|lastname|surname|family name/, "lastName"],
  [/full name|contact name|contact person|primary contact/, "fullName"],
  [/e ?mail/, "email"],
  [/mobile|cell/, "phone2"],
  [/phone|telephone|^tel$/, "phone"],
  [/address (line )?2|unit|suite|apt|apartment/, "unit"],
  [/street|address/, "street"],
  [/city|town|municipality/, "city"],
  [/province|state|region/, "province"],
  [/postal|zip/, "postalCode"],
  [/type|category/, "type"],
  [/source|referr|hear about/, "source"],
  [/tag|label/, "tags"],
  [/note|comment|description|memo/, "notes"],
];

/** Guess the mapping from the header names, with a look at sample values for addresses. */
export function guessMapping(table: CsvTable): ImportField[] {
  const used = new Set<ImportField>();
  return table.headers.map((h, col) => {
    const n = norm(h);
    let field: ImportField = "custom";
    for (const [re, f] of RULES) {
      if (!re.test(n)) continue;
      field = f;
      break;
    }
    // A single "Address" column holding "street, city, province postal" is a full address.
    if (field === "street" && !/street|line 1|address 1/.test(n)) {
      const sample = table.rows.slice(0, 50).map((r) => r[col]).filter(Boolean);
      if (sample.length && sample.filter((v) => v.split(",").length >= 3).length / sample.length > 0.6) field = "fullAddress";
    }
    // A second phone column becomes the mobile; a second contact group becomes the 3rd contact.
    if (field === "phone" && used.has("phone")) field = "phone2";
    if (field.startsWith("contact2") && used.has(field)) field = field.replace("contact2", "contact3") as ImportField;
    if (!MULTI.includes(field) && used.has(field)) field = "custom";
    used.add(field);
    return field;
  });
}

// ---------------------------------------------------------------------------

export const phoneDigits = (p: string | null | undefined) => (p ? p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : "");
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

const PROVINCES: Record<string, string> = {
  "british columbia": "BC", bc: "BC", "b c": "BC", alberta: "AB", ab: "AB", saskatchewan: "SK", sk: "SK", manitoba: "MB", mb: "MB",
  ontario: "ON", on: "ON", quebec: "QC", qc: "QC", "new brunswick": "NB", nb: "NB", "nova scotia": "NS", ns: "NS",
  "prince edward island": "PE", pe: "PE", pei: "PE", "newfoundland and labrador": "NL", newfoundland: "NL", nl: "NL",
  yukon: "YT", yt: "YT", "northwest territories": "NT", nt: "NT", nunavut: "NU", nu: "NU", washington: "WA", wa: "WA",
};
export function normalizeProvince(p: string | null | undefined): string {
  const k = norm(p ?? "");
  return PROVINCES[k] ?? (k.length === 2 ? k.toUpperCase() : "BC");
}
export function normalizePostal(p: string | null | undefined): string | null {
  const c = (p ?? "").toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(c)) return `${c.slice(0, 3)} ${c.slice(3)}`;
  return p?.trim() || null;
}
export const streetKey = (s: string | null | undefined) =>
  norm(s ?? "")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(drive|dr)\b/g, "dr");

/** "123 Main St, Surrey, BC V3S 1A1" → parts. Best effort; anything unclear stays in the street. */
export function splitFullAddress(full: string): { street: string; city: string | null; province: string; postalCode: string | null } {
  const parts = full.split(",").map((p) => p.trim()).filter(Boolean);
  const postalMatch = full.toUpperCase().match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/);
  const postalCode = postalMatch ? normalizePostal(postalMatch[0]) : null;
  if (parts.length < 2) return { street: full.trim(), city: null, province: "BC", postalCode };
  const tail = parts.slice(1).map((p) => p.replace(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i, "").trim()).filter((p) => p && !/^canada$/i.test(p));
  const provIdx = tail.findIndex((p) => PROVINCES[norm(p)] || PROVINCES[norm(p.split(" ")[0])]);
  const province = provIdx >= 0 ? normalizeProvince(PROVINCES[norm(tail[provIdx])] ? tail[provIdx] : tail[provIdx].split(" ")[0]) : "BC";
  const city = tail.filter((_, i) => i !== provIdx)[0] ?? null;
  return { street: parts[0], city, province, postalCode };
}

function splitName(full: string): { firstName: string; lastName: string } {
  const p = full.trim().split(/\s+/);
  if (p.length === 1) return { firstName: p[0], lastName: "" };
  return { firstName: p.slice(0, -1).join(" "), lastName: p.at(-1)! };
}

// ---------------------------------------------------------------------------

export interface ExistingCustomer {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  notes: string | null;
  contactEmails: string[];
  contactPhones: string[];
  streets: string[];
}

export interface PlannedContact {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  isPrimary: boolean;
}
export interface PlannedProperty {
  street: string;
  unit: string | null;
  city: string | null;
  province: string;
  postalCode: string | null;
}
export interface PlannedCustomer {
  rowNumbers: number[];
  action: "create" | "merge";
  existingId: string | null;
  existingName: string | null;
  matchedBy: "email" | "phone" | null;
  customer: {
    displayName: string;
    type: "residential" | "commercial" | "strata";
    email: string | null;
    phone: string | null;
    source: string | null;
    tags: string[];
    notes: string | null;
    importRef: string | null;
    customFields: Record<string, string>;
  };
  /** For merges: only fields that are empty on the existing customer. */
  fill: Partial<{ email: string; phone: string; source: string; notes: string }>;
  contacts: PlannedContact[];
  properties: PlannedProperty[];
  warnings: string[];
}
export interface ImportPlan {
  customers: PlannedCustomer[];
  skipped: { rowNumber: number; reason: string }[];
}

interface RowValues {
  [k: string]: string;
}

function rowValues(headers: string[], row: string[], mapping: ImportField[]) {
  const v: RowValues = {};
  const custom: Record<string, string> = {};
  const notes: string[] = [];
  const tags: string[] = [];
  mapping.forEach((field, i) => {
    const value = (row[i] ?? "").trim();
    if (!value || field === "ignore") return;
    if (field === "custom") custom[headers[i].slice(0, 60)] = value.slice(0, 500);
    else if (field === "notes") notes.push(value);
    else if (field === "tags") tags.push(...value.split(/[,;|]/).map((t) => t.trim()).filter(Boolean));
    else v[field] = value;
  });
  return { v, custom, notes, tags };
}

function customerType(name: string, company: string | undefined, typeText: string | undefined): PlannedCustomer["customer"]["type"] {
  const t = `${typeText ?? ""} ${name}`.toLowerCase();
  if (/strata|\b(bcs|lms|nw|eps|vis|vr|kas)\s?\d{2,5}\b/.test(t)) return "strata";
  if (/commercial|business|property manage|ltd|inc\b|corp/.test(t) || (company && !/residential|homeowner/.test(t))) return "commercial";
  return "residential";
}

/** Decide what to do with every row. `existing` is every current customer, for duplicate checks. */
export function planCustomerImport(table: CsvTable, mapping: ImportField[], existing: ExistingCustomer[], source = "markate"): ImportPlan {
  const byEmail = new Map<string, ExistingCustomer>();
  const byPhone = new Map<string, ExistingCustomer>();
  for (const c of existing) {
    for (const e of [c.email, ...c.contactEmails]) if (e) byEmail.set(e.toLowerCase(), c);
    for (const p of [c.phone, ...c.contactPhones]) {
      const d = phoneDigits(p);
      if (d.length >= 10) byPhone.set(d, c);
    }
  }

  const planned: PlannedCustomer[] = [];
  const inFile = new Map<string, PlannedCustomer>();
  const skipped: ImportPlan["skipped"] = [];

  table.rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // spreadsheet row, after the header
    const { v, custom, notes, tags } = rowValues(table.headers, row, mapping);
    const warnings: string[] = [];

    let first = v.firstName ?? "";
    let last = v.lastName ?? "";
    if (!first && !last && v.fullName) ({ firstName: first, lastName: last } = splitName(v.fullName));
    const personName = [first, last].filter(Boolean).join(" ");
    let email: string | null = v.email?.toLowerCase().replace(/^mailto:/, "") ?? null;
    if (email && !EMAIL_RE.test(email)) {
      warnings.push(`“${v.email}” isn't a valid email, so it was kept in the notes.`);
      notes.push(`Email from import: ${v.email}`);
      email = null;
    }
    const phone = v.phone || null;
    const phone2 = v.phone2 || null;
    const displayName = v.displayName || v.company || personName || email || "";
    if (!displayName && !phone) {
      skipped.push({ rowNumber, reason: "No name, email or phone" });
      return;
    }

    let address: PlannedProperty | null = null;
    if (v.street || v.fullAddress) {
      const split = v.fullAddress && !v.street ? splitFullAddress(v.fullAddress) : null;
      address = {
        street: (split?.street ?? v.street ?? "").slice(0, 300),
        unit: v.unit || null,
        city: v.city || split?.city || null,
        province: v.province ? normalizeProvince(v.province) : (split?.province ?? "BC"),
        postalCode: normalizePostal(v.postalCode) ?? split?.postalCode ?? null,
      };
    }

    const type = customerType(displayName, v.company, v.type);
    // A homeowner listed only by "Customer name" still gets a first name for the proposal greeting.
    if (!first && !last && type === "residential" && displayName && displayName !== email) ({ firstName: first, lastName: last } = splitName(displayName));
    const contacts: PlannedContact[] = [];
    if (first || last || email || phone) contacts.push({ firstName: first, lastName: last, email, phone, phone2, isPrimary: true });
    for (const n of ["2", "3"]) {
      const name = v[`contact${n}Name`];
      const ce = v[`contact${n}Email`]?.toLowerCase() ?? null;
      const cp = v[`contact${n}Phone`] ?? null;
      if (!name && !ce && !cp) continue;
      const sn = splitName(name ?? "");
      contacts.push({ firstName: sn.firstName, lastName: sn.lastName, email: ce && EMAIL_RE.test(ce) ? ce : null, phone: cp, phone2: null, isPrimary: false });
    }

    // Same customer appearing on several rows (e.g. one row per service address).
    const key = v.externalId ? `id:${v.externalId}` : email ? `e:${email}` : phoneDigits(phone).length >= 10 ? `p:${phoneDigits(phone)}` : `n:${norm(displayName)}|${streetKey(address?.street)}`;
    const again = inFile.get(key);
    if (again) {
      again.rowNumbers.push(rowNumber);
      if (address && !again.properties.some((p) => streetKey(p.street) === streetKey(address!.street))) again.properties.push(address);
      for (const c of contacts.filter((c) => !c.isPrimary)) if (!again.contacts.some((x) => x.email === c.email && phoneDigits(x.phone) === phoneDigits(c.phone))) again.contacts.push(c);
      again.warnings.push(...warnings);
      return;
    }

    const match = (email && byEmail.get(email)) || (phoneDigits(phone).length >= 10 && byPhone.get(phoneDigits(phone))) || null;
    const p: PlannedCustomer = {
      rowNumbers: [rowNumber],
      action: match ? "merge" : "create",
      existingId: match ? match.id : null,
      existingName: match ? match.displayName : null,
      matchedBy: match ? (email && byEmail.get(email) ? "email" : "phone") : null,
      customer: {
        displayName: displayName.slice(0, 200),
        type,
        email,
        phone,
        source: v.source?.slice(0, 100) || null,
        tags: [...new Set([...tags, `${source}-import`])],
        notes: notes.length ? notes.join("\n\n").slice(0, 5000) : null,
        importRef: v.externalId ?? null,
        customFields: custom,
      },
      fill: {},
      contacts,
      properties: address?.street ? [address] : [],
      warnings,
    };
    if (match) {
      const knownEmails = new Set([match.email, ...match.contactEmails].filter(Boolean).map((e) => e!.toLowerCase()));
      const knownPhones = new Set([match.phone, ...match.contactPhones].map(phoneDigits).filter(Boolean));
      const knownStreets = new Set(match.streets.map(streetKey));
      if (!match.email && email) p.fill.email = email;
      if (!match.phone && phone) p.fill.phone = phone;
      if (!match.source && p.customer.source) p.fill.source = p.customer.source;
      if (p.customer.notes && !(match.notes ?? "").includes(p.customer.notes)) p.fill.notes = p.customer.notes;
      p.contacts = contacts
        .filter((c) => !(c.email && knownEmails.has(c.email)) && !(phoneDigits(c.phone) && knownPhones.has(phoneDigits(c.phone))))
        .map((c) => ({ ...c, isPrimary: false }));
      p.properties = p.properties.filter((a) => !knownStreets.has(streetKey(a.street)));
    }
    inFile.set(key, p);
    planned.push(p);
  });

  return { customers: planned, skipped };
}

export function planSummary(plan: ImportPlan) {
  const create = plan.customers.filter((c) => c.action === "create");
  const merge = plan.customers.filter((c) => c.action === "merge");
  return {
    create: create.length,
    merge: merge.length,
    skipped: plan.skipped.length,
    contacts: plan.customers.reduce((n, c) => n + c.contacts.length, 0),
    properties: plan.customers.reduce((n, c) => n + c.properties.length, 0),
    warnings: plan.customers.reduce((n, c) => n + c.warnings.length, 0),
    rows: plan.customers.reduce((n, c) => n + c.rowNumbers.length, 0) + plan.skipped.length,
  };
}

/**
 * Field limits every lead shares (manual form, website form, YouCanBook.me), and the
 * clean-up that lets a lead from the web through with whatever is readable instead of
 * rejecting it for one bad field. Pure, so tests and the server share it.
 */
import { z } from "zod";
import { parseBusinessDateTime } from "@/lib/time";

/** Longest text kept in one lead field. The stored webhook keeps the full submission. */
export const LEAD_TEXT_MAX = 2000;
export const PROJECT_TYPE_MAX = 100;
export const PROJECT_TYPES_MAX = 20;

export const leadEmail = z.string().trim().toLowerCase().email();

/** What a website form or booking can carry (the same names as the lead input). */
export interface InboundLead {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  unit?: string | null;
  city?: string | null;
  postalCode?: string | null;
  propertyType?: string | null;
  projectTypes?: string[];
  description?: string | null;
  timeline?: string | null;
  leadSource?: string | null;
  visitAt?: string | Date | null;
  bookingRef?: string | null;
  bookingManageUrl?: string | null;
  notes?: string | null;
}

type TextField = Exclude<keyof InboundLead, "email" | "projectTypes" | "visitAt" | "notes">;

const TEXT_FIELDS: Record<TextField, string> = {
  firstName: "first name",
  lastName: "last name",
  company: "company",
  phone: "phone",
  street: "address",
  unit: "unit",
  city: "city",
  postalCode: "postal code",
  propertyType: "property type",
  description: "message",
  timeline: "timeline",
  leadSource: "how they heard about us",
  bookingRef: "booking reference",
  bookingManageUrl: "booking link",
};

export type CleanLead = { [K in TextField]: string | null } & {
  email: string | null;
  projectTypes: string[];
  visitAt: string | Date | null;
  notes: string | null;
};

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Keeps whatever is readable: an email that isn't valid and a visit time that can't be
 * read are kept as notes, text that is too long is cut to fit, and blank fields become
 * empty. The result always passes the lead input schema.
 */
export function cleanInboundLead(raw: InboundLead): CleanLead {
  const notes: string[] = [];
  const shortened: string[] = [];
  const out = {} as CleanLead;
  for (const [field, label] of Object.entries(TEXT_FIELDS) as [TextField, string][]) {
    const v = text(raw[field]);
    if (v.length > LEAD_TEXT_MAX) shortened.push(label);
    out[field] = v.slice(0, LEAD_TEXT_MAX).trimEnd() || null;
  }

  const email = text(raw.email);
  const valid = email ? leadEmail.safeParse(email) : null;
  out.email = valid?.success ? valid.data : null;
  if (valid && !valid.success) notes.push(`Email as received: ${clip(email, 200)}`);

  const visit = raw.visitAt instanceof Date ? raw.visitAt : text(raw.visitAt);
  out.visitAt = visit && parseBusinessDateTime(visit) ? visit : null;
  if (visit && !out.visitAt) notes.push(`Visit time as received: ${clip(String(visit), 200)}`);

  const types = [...new Set((raw.projectTypes ?? []).map((t) => text(t).slice(0, PROJECT_TYPE_MAX).trimEnd()).filter(Boolean))];
  if (types.length > PROJECT_TYPES_MAX) shortened.push("project types");
  out.projectTypes = types.slice(0, PROJECT_TYPES_MAX);

  if (shortened.length) notes.push(`Too long to keep in full, so shortened: ${shortened.join(", ")}. The full text is saved with the original submission.`);
  out.notes = [text(raw.notes), ...notes].filter(Boolean).join("\n").slice(0, LEAD_TEXT_MAX).trimEnd() || null;
  return out;
}

const hasContent = (v: string | null | undefined) => !!v && /[\p{L}\p{N}]/u.test(v);

/** Whether a cleaned lead says who it's from: a name, company, valid email or phone number. */
export function identifiesPerson(lead: Pick<CleanLead, "firstName" | "lastName" | "company" | "email" | "phone">): boolean {
  return [lead.firstName, lead.lastName, lead.company, lead.email, lead.phone].some(hasContent);
}

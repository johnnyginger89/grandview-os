import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { LeadInput } from "./leads";

/** Constant-time check of the shared webhook secret (header or ?key=). */
export function verifyWebhookSecret(req: Request): boolean {
  const expected = process.env.INBOUND_WEBHOOK_SECRET;
  if (!expected) return false;
  const provided = req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Payload = Record<string, unknown>;

/** Read the first non-empty value among several possible field names (case-insensitive). */
export function pick(p: Payload, ...keys: string[]): string | null {
  const lower = new Map(Object.entries(p).map(([k, v]) => [k.toLowerCase().replace(/[\s_-]/g, ""), v]));
  for (const k of keys) {
    const v = lower.get(k.toLowerCase().replace(/[\s_-]/g, ""));
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function splitList(v: string | null): string[] {
  if (!v) return [];
  return v.split(/[,;\n|]/).map((s) => s.trim()).filter(Boolean);
}

/** Map a form or booking payload with flexible field names onto a lead. */
export function payloadToLead(p: Payload): LeadInput {
  let firstName = pick(p, "firstName", "fname", "first", "first_name");
  let lastName = pick(p, "lastName", "lname", "last", "last_name", "surname");
  const full = pick(p, "name", "fullName", "full_name");
  if (!firstName && full) {
    const parts = full.split(/\s+/);
    firstName = parts.shift() ?? null;
    lastName = lastName ?? (parts.join(" ") || null);
  }
  return {
    firstName,
    lastName,
    company: pick(p, "company", "organization", "business"),
    email: pick(p, "email", "emailAddress", "e-mail"),
    phone: pick(p, "phone", "phoneNumber", "mobile", "tel", "telephone"),
    street: pick(p, "address", "street", "jobAddress", "streetAddress", "address1"),
    unit: pick(p, "unit", "suite", "suiteUnit", "address2"),
    city: pick(p, "city", "town"),
    postalCode: pick(p, "postalCode", "postal", "postcode", "zip"),
    propertyType: pick(p, "propertyType", "property"),
    projectTypes: splitList(pick(p, "projectTypes", "projectType", "services", "service", "workType")),
    description: pick(p, "description", "message", "projectDescription", "comments", "details", "tellUsAboutYourProject"),
    timeline: pick(p, "timeline", "timeframe", "when"),
    leadSource: pick(p, "leadSource", "source", "howDidYouHear", "howDidYouHearAboutUs", "referral"),
    visitAt: pick(p, "visitAt", "startTime", "start", "appointment", "bookingStart", "datetime") as unknown as Date | null,
    bookingRef: pick(p, "bookingRef", "bookingId", "reference", "ref", "id"),
    bookingManageUrl: pick(p, "manageUrl", "manageBookingUrl", "bookingManageUrl", "cancelUrl", "rescheduleUrl"),
  };
}

/**
 * What happens when new details arrive for a lead or customer that already exists (a
 * second website form, a booking, a rebook): empty fields are filled, nothing on file is
 * overwritten, and anything that differs is listed for the timeline so staff can decide.
 * Also which stages a cancelled booking may move to Lost. Pure, so it can be tested.
 */

/** Stages before the estimate visit (keys from the seed). Only these are lost when a booking is cancelled. */
export const PRE_VISIT_STAGE_KEYS = ["new_lead", "contacted", "estimate_booked"] as const;

/** Lost reason set by a booking cancellation; booking again reopens leads lost this way. */
export const BOOKING_CANCELLED_REASON = "Booking cancelled";

/** A cancelled booking loses the lead only while the estimate visit is still ahead. */
export function cancellationLosesLead(stage: { key: string; kind: string }): boolean {
  return stage.kind === "open" && (PRE_VISIT_STAGE_KEYS as readonly string[]).includes(stage.key);
}

/** A lead that a booking cancellation (not a person) moved to Lost. */
export function lostToCancellation(opp: { lostReason: string | null }, stage: { kind: string }): boolean {
  return stage.kind === "lost" && opp.lostReason === BOOKING_CANCELLED_REASON;
}

/** Digits only, without a leading North American 1. */
export function normalizePhone(p: string | null | undefined): string | null {
  return p ? p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : null;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function samePhone(a: string, b: string): boolean {
  const da = normalizePhone(a);
  const db = normalizePhone(b);
  return da && db ? da === db : sameText(a, b);
}

/**
 * New text added under a heading at the end of what's there. Returns null when there is
 * nothing to add or the text is already there (a booking sent again repeats its message).
 */
export function appendText(existing: string | null, addition: string | null, heading: string): string | null {
  const add = addition?.trim();
  if (!add) return null;
  const current = existing?.trim();
  if (!current) return add;
  if (squash(current).includes(squash(add))) return null;
  return `${current}\n\n${heading}:\n${add}`;
}

export interface LeadOnFile {
  source: string | null;
  projectTypes: string[];
  timeline: string | null;
  description: string | null;
  propertyId: string | null;
}

export interface NewLeadDetails {
  source: string | null;
  projectTypes: string[];
  timeline: string | null;
  description: string | null;
  propertyId: string | null;
  /** The address of propertyId, to mention when the lead already has another one. */
  address: string | null;
}

export interface LeadMerge {
  patch: { source?: string; projectTypes?: string[]; timeline?: string; description?: string; propertyId?: string };
  /** The new message, when it isn't already on the lead. */
  message: string | null;
  /** Details that differ from what's on file and were left for staff to decide. */
  mentions: string[];
}

export function planLeadMerge(onFile: LeadOnFile, incoming: NewLeadDetails, heading: string): LeadMerge {
  const patch: LeadMerge["patch"] = {};
  const mentions: string[] = [];

  if (incoming.source) {
    if (!onFile.source) patch.source = incoming.source;
    else if (!sameText(onFile.source, incoming.source)) mentions.push(`Heard about us via: ${incoming.source} (on file: ${onFile.source})`);
  }

  const newTypes = incoming.projectTypes.filter((t, i, all) => all.findIndex((x) => sameText(x, t)) === i && !onFile.projectTypes.some((o) => sameText(o, t)));
  if (newTypes.length) {
    if (!onFile.projectTypes.length) patch.projectTypes = newTypes;
    else mentions.push(`Also asked about: ${newTypes.join(", ")}`);
  }

  if (incoming.timeline) {
    if (!onFile.timeline) patch.timeline = incoming.timeline;
    else if (!sameText(onFile.timeline, incoming.timeline)) mentions.push(`Timeline given: ${incoming.timeline} (on file: ${onFile.timeline})`);
  }

  if (incoming.propertyId && incoming.propertyId !== onFile.propertyId) {
    if (!onFile.propertyId) patch.propertyId = incoming.propertyId;
    else if (incoming.address) mentions.push(`Address given: ${incoming.address}`);
  }

  const description = appendText(onFile.description, incoming.description, heading);
  if (description !== null) patch.description = description;
  return { patch, message: description === null ? null : incoming.description!.trim(), mentions };
}

export interface ContactsOnFile {
  customer: { email: string | null; phone: string | null };
  /** The primary contact, whose details the lead page shows first. */
  primary: { email: string | null; phone: string | null } | null;
  /** Every email and phone number already on the customer, on any contact. */
  emails: (string | null)[];
  phones: (string | null)[];
}

export interface ContactMerge {
  customer: { email?: string; phone?: string };
  primary: { email?: string; phone?: string };
  /** What was added, and new values left for staff because one is already on file. */
  mentions: string[];
}

export function planContactMerge(onFile: ContactsOnFile, incoming: { email: string | null; phone: string | null }): ContactMerge {
  const out: ContactMerge = { customer: {}, primary: {}, mentions: [] };
  const fields = [
    { key: "email", label: "email", value: incoming.email, known: onFile.emails, same: sameText },
    { key: "phone", label: "phone number", value: incoming.phone, known: onFile.phones, same: samePhone },
  ] as const;
  for (const f of fields) {
    const value = f.value?.trim();
    if (!value || f.known.some((k) => !!k && f.same(k, value))) continue;
    const shown = onFile.primary?.[f.key] || onFile.customer[f.key];
    if (shown) {
      out.mentions.push(`New ${f.label} given: ${value} (on file: ${shown})`);
      continue;
    }
    if (!onFile.customer[f.key]) out.customer[f.key] = value;
    if (onFile.primary && !onFile.primary[f.key]) out.primary[f.key] = value;
    out.mentions.push(`${f.label[0].toUpperCase()}${f.label.slice(1)} added: ${value}`);
  }
  return out;
}

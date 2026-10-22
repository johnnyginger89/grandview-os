import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  activities,
  colourSelections,
  contacts,
  crewMembers,
  crews,
  customers,
  projects,
  properties,
  scheduleEntries,
  type ColourClient,
  type ColourRow,
  type ColourSelectionStatus,
  type ColourSignedVia,
} from "@/db/schema";
import { messageTemplates } from "@/db/schema";
import { MESSAGE_TEMPLATES } from "@/db/seed-data";
import {
  COLOUR_FORM_SETTING_KEY,
  colourDraftSchema,
  colourFormSettingsSchema,
  colourLinkSchema,
  colourSignSchema,
  defaultColourFormSettings,
  splitColour,
  type ColourFormSettings,
} from "@/lib/colours/schemas";
import { sameEmail, samePhone, type Reach } from "@/lib/customer-reach";
import { sendEmail } from "@/lib/email";
import { isIncluded } from "@/lib/estimating/engine";
import type { EstimateDoc } from "@/lib/estimating/document";
import { jobTitle } from "@/lib/schedule/format";
import { formatAddress, formatDate, renderTemplate } from "@/lib/utils";
import { audit } from "./audit";
import { postSystemMessage } from "./job-chat";
import { notify, notifyLater, officeRecipients } from "./notifications";
import { markColoursChosen } from "./readiness";
import { getScheduleSettings } from "./schedule-settings";
import { getCompany, getSetting, setSetting } from "./settings";
import { signedDocForProject } from "./work-orders";

/*
 * Colour selections: what gets painted which colour, signed off by the customer. Staff
 * and the booked colour consultant fill a form in; the customer can fill it in and sign
 * through a link (only the link's sha256 is stored, as for work-order links). Signing
 * freezes it, ticks off the job's colour-consult readiness check, notes it on the
 * customer's history and feeds the work order. Changing colours afterwards starts a new
 * form that replaces the signed one when it is signed. No money anywhere.
 * Callers check permissions; the token is the permission for the customer's link.
 */

export class ColourFormError extends Error {
  readonly expose = true;
}

type Actor = { id: string; name?: string | null };
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const OPEN: ColourSelectionStatus[] = ["draft", "sent"];
const NOT_FOUND = "This colour form no longer exists. Refresh the page.";
const LOCKED = "This colour form has been signed, so it can't be changed. Use “Change colours” to start a new one.";
const LINK_TOKEN = "[Colour form link]";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getColourFormSettings(): Promise<ColourFormSettings> {
  const parsed = colourFormSettingsSchema.safeParse(await getSetting<unknown>(COLOUR_FORM_SETTING_KEY, {}));
  if (parsed.success) return parsed.data;
  console.error(`[colours] stored ${COLOUR_FORM_SETTING_KEY} setting is invalid, using defaults`);
  return defaultColourFormSettings();
}

/** Callers check settings.manage. */
export async function saveColourFormSettings(raw: unknown, actor: Actor): Promise<ColourFormSettings> {
  const next = colourFormSettingsSchema.parse(raw);
  const before = await getColourFormSettings();
  await setSetting(COLOUR_FORM_SETTING_KEY, next, actor.id);
  await audit({ actorId: actor.id, action: "settings.colour_form", entityType: "settings", entityId: COLOUR_FORM_SETTING_KEY, before, after: next });
  return next;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export function colourFormUrl(token: string): string {
  const base = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
  return `${base}/share/c/${token}`;
}

// ---------------------------------------------------------------------------
// What the form shows
// ---------------------------------------------------------------------------

export interface ColourFormData {
  id: string;
  status: ColourSelectionStatus;
  projectId: string;
  projectNumber: number;
  jobTitle: string;
  address: string | null;
  rows: ColourRow[];
  client: ColourClient;
  notes: string | null;
  /** The warnings to agree to: the signed wording once signed, else the current settings. */
  warnings: { change: string; coverage: string };
  sheens: string[];
  surfaces: string[];
  /** Room names from the estimate, to pick from. */
  rooms: string[];
  company: { name: string; phone: string | null };
  signed: { name: string; at: string; signature: string; via: ColourSignedVia | null; hash: string } | null;
  link: { sentAt: string | null; sentTo: string | null; expiresAt: string | null } | null;
  replacesId: string | null;
}

type SelectionRow = typeof colourSelections.$inferSelect;

async function projectInfo(projectId: string) {
  if (!UUID_RE.test(projectId)) return null;
  const [p] = await db
    .select({ id: projects.id, number: projects.number, name: projects.name, status: projects.status, customerId: projects.customerId, propertyId: projects.propertyId, projectManagerId: projects.projectManagerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return p ?? null;
}
type ProjectInfo = NonNullable<Awaited<ReturnType<typeof projectInfo>>>;

async function addressOf(propertyId: string | null): Promise<string | null> {
  if (!propertyId) return null;
  const [pr] = await db
    .select({ street: properties.street, unit: properties.unit, city: properties.city, province: properties.province, postalCode: properties.postalCode })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return pr?.street ? formatAddress(pr) : null;
}

const isPrep = (category: string | null | undefined) => (category ?? "").trim().toLowerCase() === "prep";

/** Room names from the estimate, parents first ("Main floor › Kitchen"). */
function roomNames(doc: EstimateDoc | null): string[] {
  if (!doc) return [];
  const byId = new Map(doc.areas.map((a) => [a.id, a]));
  return [...new Set(doc.areas.map((a) => (a.parentId && byId.get(a.parentId) ? `${byId.get(a.parentId)!.name} › ${a.name}` : a.name)).filter(Boolean))];
}

/**
 * One row per painted surface the customer is getting, from the signed estimate: room,
 * surface and whatever colour and sheen the estimate already has. Each row remembers its
 * estimate line, so the work order can show the chosen colour on that item.
 */
export function rowsFromEstimate(doc: EstimateDoc | null): ColourRow[] {
  if (!doc) return [];
  const byId = new Map(doc.areas.map((a) => [a.id, a]));
  const room = (areaId: string | null) => {
    const a = areaId ? byId.get(areaId) : undefined;
    if (!a) return "";
    const parent = a.parentId ? byId.get(a.parentId) : undefined;
    return parent ? `${parent.name} › ${a.name}` : a.name;
  };
  return doc.lines
    .filter((l) => isIncluded(l) && !isPrep(l.rateSnapshot.category) && l.rateSnapshot.unit !== "hour" && l.coats > 0)
    .map((l) => {
      const { code, colour } = splitColour(l.colour);
      const surface = l.customerDescription?.trim() || l.rateSnapshot.customerLabel?.trim() || l.description.split(" – ")[0].trim();
      return { id: randomUUID(), room: room(l.areaId), surface, colour, code, sheen: l.sheen?.trim() ?? "", lineId: l.id };
    });
}

async function clientFor(p: ProjectInfo): Promise<ColourClient> {
  const [customerRows, contactRows, address] = await Promise.all([
    db.select({ name: customers.displayName, email: customers.email, phone: customers.phone }).from(customers).where(eq(customers.id, p.customerId)).limit(1),
    db
      .select({ firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone })
      .from(contacts)
      .where(and(eq(contacts.customerId, p.customerId), eq(contacts.isPrimary, true)))
      .limit(1),
    addressOf(p.propertyId),
  ]);
  const c = customerRows[0];
  const k = contactRows[0];
  const contactName = [k?.firstName, k?.lastName].filter(Boolean).join(" ").trim();
  return {
    name: contactName || c?.name || "",
    email: k?.email?.trim() || c?.email?.trim() || "",
    phone: k?.phone?.trim() || c?.phone?.trim() || "",
    address: address ?? "",
  };
}

async function formData(s: SelectionRow, p: ProjectInfo): Promise<ColourFormData> {
  const [settings, company, address, doc] = await Promise.all([getColourFormSettings(), getCompany(), addressOf(p.propertyId), signedDocForProject(p.id)]);
  const signed = s.status === "signed" || s.status === "replaced";
  return {
    id: s.id,
    status: s.status,
    projectId: p.id,
    projectNumber: p.number ?? 0,
    jobTitle: jobTitle(p.name),
    address,
    rows: s.rows ?? [],
    client: s.client,
    notes: s.notes,
    warnings: signed && s.acknowledged ? { change: s.acknowledged.changeWarning, coverage: s.acknowledged.coverageWarning } : { change: settings.changeWarning, coverage: settings.coverageWarning },
    sheens: settings.sheens,
    surfaces: settings.surfaces,
    rooms: roomNames(doc),
    company: { name: (company.displayName || company.name || "").trim(), phone: company.phone?.trim() || null },
    signed:
      signed && s.signedAt
        ? { name: s.signedName ?? "", at: s.signedAt.toISOString(), signature: s.signature ?? "", via: s.signedVia ?? null, hash: s.documentHash ?? "" }
        : null,
    link: s.linkSentAt || s.linkExpiresAt ? { sentAt: s.linkSentAt?.toISOString() ?? null, sentTo: s.linkSentTo, expiresAt: s.linkExpiresAt?.toISOString() ?? null } : null,
    replacesId: s.replacesId,
  };
}

async function selection(id: string): Promise<SelectionRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [s] = await db.select().from(colourSelections).where(eq(colourSelections.id, id)).limit(1);
  return s ?? null;
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface ColourSelectionSummary {
  id: string;
  status: ColourSelectionStatus;
  projectId: string;
  projectNumber: number;
  jobTitle: string;
  rowCount: number;
  signedName: string | null;
  signedAt: string | null;
  signedVia: ColourSignedVia | null;
  linkSentAt: string | null;
  linkSentTo: string | null;
  updatedAt: string;
}

function summaries(rows: (SelectionRow & { projectNumber: number | null; projectName: string })[]): ColourSelectionSummary[] {
  return rows.map((s) => ({
    id: s.id,
    status: s.status,
    projectId: s.projectId,
    projectNumber: s.projectNumber ?? 0,
    jobTitle: jobTitle(s.projectName),
    rowCount: (s.rows ?? []).length,
    signedName: s.signedName,
    signedAt: s.signedAt?.toISOString() ?? null,
    signedVia: s.signedVia ?? null,
    linkSentAt: s.linkSentAt?.toISOString() ?? null,
    linkSentTo: s.linkSentTo,
    updatedAt: s.updatedAt.toISOString(),
  }));
}

const withProject = { projectNumber: projects.number, projectName: projects.name };

/** A job's colour forms, newest first (cancelled ones left out). */
export async function listColourSelections(projectId: string): Promise<ColourSelectionSummary[]> {
  if (!UUID_RE.test(projectId)) return [];
  const rows = await db
    .select({ s: colourSelections, ...withProject })
    .from(colourSelections)
    .innerJoin(projects, eq(projects.id, colourSelections.projectId))
    .where(and(eq(colourSelections.projectId, projectId), inArray(colourSelections.status, ["draft", "sent", "signed", "replaced"])))
    .orderBy(desc(colourSelections.createdAt));
  return summaries(rows.map((r) => ({ ...r.s, projectNumber: r.projectNumber, projectName: r.projectName })));
}

/** The customer file: every signed or open colour form across their jobs. */
export async function listColourSelectionsForCustomer(customerId: string): Promise<ColourSelectionSummary[]> {
  if (!UUID_RE.test(customerId)) return [];
  const rows = await db
    .select({ s: colourSelections, ...withProject })
    .from(colourSelections)
    .innerJoin(projects, eq(projects.id, colourSelections.projectId))
    .where(and(eq(colourSelections.customerId, customerId), inArray(colourSelections.status, ["draft", "sent", "signed", "replaced"])))
    .orderBy(desc(colourSelections.createdAt))
    .limit(100);
  return summaries(rows.map((r) => ({ ...r.s, projectNumber: r.projectNumber, projectName: r.projectName })));
}

export async function getColourFormForStaff(id: string): Promise<ColourFormData | null> {
  const s = await selection(id);
  if (!s) return null;
  const p = await projectInfo(s.projectId);
  return p ? formData(s, p) : null;
}

/** The job's open form (draft or sent), else a new one filled from the signed estimate. */
export async function startColourSelection(projectId: string, actor: Actor): Promise<{ id: string; projectId: string; created: boolean }> {
  const p = await projectInfo(projectId);
  if (!p) throw new ColourFormError("This job no longer exists.");
  if (p.status === "cancelled") throw new ColourFormError("This job was cancelled.");
  const [open] = await db
    .select({ id: colourSelections.id })
    .from(colourSelections)
    .where(and(eq(colourSelections.projectId, p.id), inArray(colourSelections.status, OPEN)))
    .orderBy(desc(colourSelections.createdAt))
    .limit(1);
  if (open) return { id: open.id, projectId: p.id, created: false };
  const [signed] = await db
    .select({ id: colourSelections.id, rows: colourSelections.rows, notes: colourSelections.notes })
    .from(colourSelections)
    .where(and(eq(colourSelections.projectId, p.id), eq(colourSelections.status, "signed")))
    .orderBy(desc(colourSelections.signedAt))
    .limit(1);
  // A job that already has signed colours starts its new form from them ("Change colours").
  const rows = signed ? signed.rows.map((r) => ({ ...r, id: randomUUID() })) : rowsFromEstimate(await signedDocForProject(p.id));
  const client = await clientFor(p);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(colourSelections)
      .values({ projectId: p.id, customerId: p.customerId, rows, client, notes: signed?.notes ?? null, replacesId: signed?.id ?? null, createdBy: actor.id, filledBy: actor.id })
      .returning({ id: colourSelections.id });
    await audit({ actorId: actor.id, action: "colours.start", entityType: "colour_selection", entityId: row.id, after: { projectId: p.id, rows: rows.length, replaces: signed?.id ?? null } }, tx);
    return { id: row.id, projectId: p.id, created: true };
  });
}

/** Office or colour consultant saving while it's open. */
export async function saveColourSelection(id: string, raw: unknown, actor: Actor): Promise<{ id: string; projectId: string }> {
  const input = colourDraftSchema.parse(raw);
  const s = await selection(id);
  if (!s || s.status === "cancelled") throw new ColourFormError(NOT_FOUND);
  if (!OPEN.includes(s.status)) throw new ColourFormError(LOCKED);
  await db
    .update(colourSelections)
    .set({ rows: input.rows, client: input.client, notes: input.notes, filledBy: actor.id, updatedAt: new Date() })
    .where(and(eq(colourSelections.id, s.id), inArray(colourSelections.status, OPEN)));
  return { id: s.id, projectId: s.projectId };
}

export async function cancelColourSelection(id: string, actor: Actor): Promise<{ projectId: string }> {
  const s = await selection(id);
  if (!s) throw new ColourFormError(NOT_FOUND);
  if (!OPEN.includes(s.status)) throw new ColourFormError("Only a form that hasn't been signed can be deleted.");
  await db.transaction(async (tx) => {
    await tx.update(colourSelections).set({ status: "cancelled", tokenHash: null, updatedAt: new Date() }).where(eq(colourSelections.id, s.id));
    await audit({ actorId: actor.id, action: "colours.cancel", entityType: "colour_selection", entityId: s.id, before: { status: s.status } }, tx);
  });
  return { projectId: s.projectId };
}

/**
 * A corrected customer email or phone reaches their open forms (draft or sent): a form
 * still showing the old value gets the new one, so its link goes to the right address.
 * Signed forms stay as signed; a different value typed on a form for its job stays.
 * Called inside the customer change's transaction. Returns how many forms changed.
 */
export async function carryReachToOpenForms(t: DbOrTx, customerId: string, before: Reach, after: Reach): Promise<number> {
  const emailChanged = !sameEmail(before.email, after.email);
  const phoneChanged = (before.phone ?? "") !== (after.phone ?? "");
  if (!emailChanged && !phoneChanged) return 0;
  const open = await t
    .select({ id: colourSelections.id, client: colourSelections.client })
    .from(colourSelections)
    .where(and(eq(colourSelections.customerId, customerId), inArray(colourSelections.status, OPEN)));
  let changed = 0;
  for (const s of open) {
    const client = { ...s.client };
    if (emailChanged && sameEmail(client.email, before.email)) client.email = after.email ?? "";
    if (phoneChanged && samePhone(client.phone, before.phone)) client.phone = after.phone ?? "";
    if (client.email === s.client.email && client.phone === s.client.phone) continue;
    await t
      .update(colourSelections)
      .set({ client, updatedAt: new Date() })
      .where(and(eq(colourSelections.id, s.id), inArray(colourSelections.status, OPEN)));
    changed++;
  }
  return changed;
}

async function emailTemplate(): Promise<{ subject: string; body: string }> {
  const t = await db.query.messageTemplates.findFirst({ where: eq(messageTemplates.key, "colour_form") });
  const fallback = MESSAGE_TEMPLATES.find((x) => x.key === "colour_form")!;
  return { subject: t?.subject || fallback.subject, body: t?.body || fallback.body };
}

/** The email for the customer's link, from the "Choosing colours" template; the link is left as [Colour form link]. */
export async function colourEmailDraft(id: string, sender: { name: string }): Promise<{ to: string; subject: string; body: string } | null> {
  const s = await selection(id);
  if (!s) return null;
  const p = await projectInfo(s.projectId);
  if (!p) return null;
  const [company, template] = await Promise.all([getCompany(), emailTemplate()]);
  const vars = {
    first_name: s.client.name.split(" ")[0] || "there",
    customer_name: s.client.name,
    job_title: jobTitle(p.name),
    colour_form_link: LINK_TOKEN,
    sender_name: sender.name,
    company_name: company.displayName || company.name,
    company_phone: company.phone ?? "",
  };
  return { to: s.client.email, subject: renderTemplate(template.subject, vars).trim(), body: renderTemplate(template.body, vars).replace(/\n{3,}/g, "\n\n").trim() };
}

/**
 * A new link for the customer to fill in and sign (any earlier link stops working).
 * Emails it only when the person sending asked to, with the text they saw.
 */
export async function createColourLink(raw: unknown, actor: Actor, now: Date = new Date()): Promise<{ url: string; projectId: string; expiresAt: string; emailStatus: "sent" | "logged" | "failed" | null; emailError?: string }> {
  const input = colourLinkSchema.parse(raw);
  const s = await selection(input.id);
  if (!s || s.status === "cancelled") throw new ColourFormError(NOT_FOUND);
  if (!OPEN.includes(s.status)) throw new ColourFormError(LOCKED);
  const settings = await getColourFormSettings();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + settings.linkDays * 86_400_000);
  const url = colourFormUrl(token);
  await db.transaction(async (tx) => {
    await tx
      .update(colourSelections)
      .set({ status: "sent", tokenHash: hashToken(token), linkExpiresAt: expiresAt, linkSentAt: now, linkSentTo: input.email?.to ?? null, updatedAt: now })
      .where(and(eq(colourSelections.id, s.id), inArray(colourSelections.status, OPEN)));
    await audit({ actorId: actor.id, action: "colours.link", entityType: "colour_selection", entityId: s.id, after: { expiresAt: expiresAt.toISOString(), emailedTo: input.email?.to ?? null } }, tx);
  });
  if (!input.email) return { url, projectId: s.projectId, expiresAt: expiresAt.toISOString(), emailStatus: null };
  const body = input.email.body.includes(LINK_TOKEN) ? input.email.body.split(LINK_TOKEN).join(url) : `${input.email.body.trimEnd()}\n\nChoose your colours: ${url}`;
  const result = await sendEmail({ to: input.email.to, subject: input.email.subject, text: body });
  await db.insert(activities).values({
    customerId: s.customerId,
    type: "email",
    body: result.status === "failed" ? `Colour form email to ${input.email.to} failed: ${result.error ?? "unknown error"}` : `Colour form sent to ${input.email.to}`,
    meta: { colourSelectionId: s.id, status: result.status },
    createdBy: actor.id,
  });
  return { url, projectId: s.projectId, expiresAt: expiresAt.toISOString(), emailStatus: result.status, emailError: result.error };
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

interface SignMeta {
  via: ColourSignedVia;
  actor: Actor | null;
  ip?: string | null;
  userAgent?: string | null;
}

async function sign(s: SelectionRow, raw: unknown, meta: SignMeta): Promise<{ id: string; projectId: string }> {
  const input = colourSignSchema.parse(raw);
  if (!OPEN.includes(s.status)) throw new ColourFormError(s.status === "cancelled" ? NOT_FOUND : "These colours have already been signed.");
  if (!input.rows.some((r) => r.colour || r.code)) throw new ColourFormError("Add at least one colour before signing.");
  const p = await projectInfo(s.projectId);
  if (!p) throw new ColourFormError(NOT_FOUND);
  const [settings, schedule] = await Promise.all([getColourFormSettings(), getScheduleSettings()]);
  const signedAt = new Date();
  const acknowledged = { changeWarning: settings.changeWarning, coverageWarning: settings.coverageWarning };
  const documentHash = createHash("sha256")
    .update(JSON.stringify({ rows: input.rows, client: input.client, notes: input.notes, acknowledged, name: input.signedName, at: signedAt.toISOString(), via: meta.via }))
    .digest("hex");

  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(colourSelections)
      .set({
        status: "signed",
        rows: input.rows,
        client: input.client,
        notes: input.notes,
        signedName: input.signedName,
        signedAt,
        signature: input.signature,
        signedVia: meta.via,
        signedIp: meta.ip ?? null,
        signedUserAgent: meta.userAgent?.slice(0, 500) ?? null,
        acknowledged,
        documentHash,
        ...(meta.actor ? { filledBy: meta.actor.id } : {}),
        updatedAt: signedAt,
      })
      .where(and(eq(colourSelections.id, s.id), inArray(colourSelections.status, OPEN)))
      .returning({ id: colourSelections.id });
    if (!claimed.length) throw new ColourFormError("These colours have already been signed.");
    if (s.replacesId) await tx.update(colourSelections).set({ status: "replaced", updatedAt: signedAt }).where(and(eq(colourSelections.id, s.replacesId), eq(colourSelections.status, "signed")));
    await markColoursChosen(tx, { projectId: p.id, checks: schedule.readinessChecks, actorId: meta.actor?.id ?? null, note: `Colours signed by ${input.signedName}, ${formatDate(signedAt)}` });
    await tx.insert(activities).values({
      customerId: s.customerId,
      type: "system",
      body: `Colour selections for job #${p.number} signed by ${input.signedName}${meta.via === "device" ? ` (in person${meta.actor?.name ? ` with ${meta.actor.name}` : ""})` : " (online)"}: ${input.rows.length} ${input.rows.length === 1 ? "row" : "rows"}.`,
      meta: { colourSelectionId: s.id, projectId: p.id, documentHash },
      createdBy: meta.actor?.id ?? null,
    });
    await audit(
      { actorId: meta.actor?.id ?? null, action: "colours.sign", entityType: "colour_selection", entityId: s.id, after: { via: meta.via, name: input.signedName, rows: input.rows.length, documentHash, ip: meta.ip ?? null } },
      tx,
    );
  });

  await postSystemMessage(p.id, `Colours signed by ${input.signedName} (${input.rows.length} ${input.rows.length === 1 ? "line" : "lines"}). They're on the work order once it's issued again.`);
  notifyLater(async () => {
    const recipients = await officeRecipients([p.projectManagerId], meta.actor?.id ?? null);
    await notify(
      recipients.map((u) => u.id),
      {
        kind: "colours.signed",
        title: `${input.client.name || "The customer"} signed their colours`,
        body: `Job #${p.number} ${jobTitle(p.name)} · ${input.rows.length} ${input.rows.length === 1 ? "colour" : "colours"}. Issue the work order again so the crew sees them.`,
        href: `/projects/${p.id}#colours`,
        entityType: "colour_selection",
        entityId: s.id,
      },
    );
  });
  return { id: s.id, projectId: p.id };
}

/** The customer signs on the office's or consultant's device. */
export async function signColourSelectionOnDevice(id: string, raw: unknown, actor: Actor): Promise<{ id: string; projectId: string }> {
  const s = await selection(id);
  if (!s) throw new ColourFormError(NOT_FOUND);
  return sign(s, raw, { via: "device", actor });
}

// ---------------------------------------------------------------------------
// The customer's link
// ---------------------------------------------------------------------------

async function byToken(token: string, now: Date): Promise<SelectionRow | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const [s] = await db.select().from(colourSelections).where(eq(colourSelections.tokenHash, hashToken(token))).limit(1);
  if (!s || s.status === "cancelled" || s.status === "draft") return null;
  // A signed copy stays readable from the link; an unsigned one only until the link expires.
  if (OPEN.includes(s.status) && (!s.linkExpiresAt || s.linkExpiresAt < now)) return null;
  return s;
}

/** Public: the form behind a link, or null for an unknown, expired or withdrawn link. */
export async function getColourFormForToken(token: string, now: Date = new Date()): Promise<ColourFormData | null> {
  const s = await byToken(token, now);
  if (!s) return null;
  const p = await projectInfo(s.projectId);
  if (!p || p.status === "cancelled") return null;
  const data = await formData(s, p);
  // The customer never sees office-only details: who sent it or when it expires.
  return { ...data, link: null };
}

/** Public: the customer saving progress before signing. */
export async function saveColourFormFromCustomer(token: string, raw: unknown): Promise<void> {
  const s = await byToken(token, new Date());
  if (!s || !OPEN.includes(s.status)) throw new ColourFormError("This colour form can no longer be changed. Please call us if something needs fixing.");
  const input = colourDraftSchema.parse(raw);
  await db.update(colourSelections).set({ rows: input.rows, client: input.client, notes: input.notes, updatedAt: new Date() }).where(and(eq(colourSelections.id, s.id), inArray(colourSelections.status, OPEN)));
}

/** Public: the customer signs through their link. */
export async function signColourFormFromLink(token: string, raw: unknown, meta: { ip: string | null; userAgent: string | null }): Promise<void> {
  const s = await byToken(token, new Date());
  if (!s) throw new ColourFormError("This colour form link has expired. Please call us for a new one.");
  await sign(s, raw, { via: "link", actor: null, ip: meta.ip, userAgent: meta.userAgent });
}

// ---------------------------------------------------------------------------
// The colour consultant (a field login) and the work order
// ---------------------------------------------------------------------------

/**
 * The job behind a colour-consult booking, when `userId` is in that booking's crew.
 * That is the only way a field login reaches a customer's colour form.
 */
export async function colourConsultProject(userId: string, entryId: string): Promise<string | null> {
  if (!userId || !UUID_RE.test(entryId)) return null;
  const [row] = await db
    .select({ projectId: scheduleEntries.projectId })
    .from(scheduleEntries)
    .innerJoin(crewMembers, eq(crewMembers.crewId, scheduleEntries.crewId))
    .innerJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .where(and(eq(scheduleEntries.id, entryId), eq(scheduleEntries.kind, "colour_consult"), isNull(scheduleEntries.deletedAt), eq(crewMembers.userId, userId), eq(crews.active, true)))
    .limit(1);
  return row?.projectId ?? null;
}

/** The job's colour form to show the colour consultant: the open one, else the latest signed one. */
export async function currentColourForm(projectId: string): Promise<ColourFormData | null> {
  const p = await projectInfo(projectId);
  if (!p) return null;
  const rows = await db
    .select()
    .from(colourSelections)
    .where(and(eq(colourSelections.projectId, p.id), inArray(colourSelections.status, ["draft", "sent", "signed"])))
    .orderBy(desc(colourSelections.createdAt));
  const pick = rows.find((s) => OPEN.includes(s.status)) ?? rows.find((s) => s.status === "signed");
  return pick ? formData(pick, p) : null;
}

import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/db/sql";
import { contacts, crewMembers, crews, customers, projects, properties, proposals, scheduleEntries, user, workOrderLinks, workOrders, workOrderVersions } from "@/db/schema";
import type { WorkOrderStatus } from "@/db/schema/work-orders";
import type { EstimateDoc } from "@/lib/estimating/document";
import { dateRangeLabel, jobTitle, kindLabel } from "@/lib/schedule/format";
import { calendarsFor, countWorkingDays } from "@/lib/schedule/working-days";
import { linkExpiresAt, linkStatus } from "@/lib/work-orders/links";
import {
  createLinkSchema,
  createWorkOrderSchema,
  defaultWorkOrderSettings,
  issueWorkOrderSchema,
  revokeLinkSchema,
  updateWorkOrderSchema,
  WORK_ORDER_SETTING_KEY,
  workOrderIdSchema,
  workOrderSettingsSchema,
  type WorkOrderSettings,
} from "@/lib/work-orders/schemas";
import type { NewWorkOrderDefaults, WorkOrderDTO, WorkOrderFieldsDTO } from "@/lib/work-orders/types";
import { audit } from "./audit";
import { crewIdsForUser } from "./crews";
import { loadEstimate } from "./estimates";
import { getScheduleSettings } from "./schedule-settings";
import { getCompany, getProposalTemplate, getSetting, setSetting } from "./settings";
import { buildWorkOrderView, changedSections, workOrderNumber, type WorkOrderInput, type WorkOrderSection, type WorkOrderView } from "./work-order-view";

/*
 * Crew work orders. Staff edit a draft; issuing freezes a crew-safe snapshot
 * (buildWorkOrderView) in work_order_versions, and crews only ever see those
 * snapshots: through /my-jobs when their crew covers the job, or through a share
 * link. A link's token is 32 random bytes; only its sha256 is stored, so a link
 * can't be read back from the database (staff copy it once, when it's created).
 *
 * Every query here names its columns and none of them is a money or hours column
 * (architecture.test.ts checks this file like the other crew-facing code).
 * Callers check permissions: projects.read_all / projects.write for staff,
 * crew membership (here) for /my-jobs, the token itself for share links.
 */

export class WorkOrderError extends Error {
  readonly expose = true;
}

type Actor = { id: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type WorkOrderRow = typeof workOrders.$inferSelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "This work order no longer exists. Refresh the page.";
const CANCELLED_WO = "This work order was cancelled. Create a new one instead.";
const CANCELLED_JOB = "This job was cancelled, so it can't get a work order.";

// ---------------------------------------------------------------------------
// Share-link tokens
// ---------------------------------------------------------------------------

export const LINK_TOKEN_BYTES = 32;
/** 32 bytes in base64url, unpadded. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A new link token and the hash that is stored. The token itself is never stored. */
export function newLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(LINK_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashLinkToken(token) };
}

export function isLinkTokenShaped(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** Constant-time check of a token against a stored hash (the lookup is by hash; this guards the match). */
export function tokenMatches(token: string, storedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashLinkToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function workOrderLinkUrl(token: string): string {
  const base = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
  return `${base}/share/wo/${token}`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** The `work_orders` setting, or the starter values when nothing valid is saved. */
export async function getWorkOrderSettings(): Promise<WorkOrderSettings> {
  const raw = await getSetting<unknown>(WORK_ORDER_SETTING_KEY, {});
  const parsed = workOrderSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  console.error(`[work-orders] stored ${WORK_ORDER_SETTING_KEY} setting is invalid, using defaults`);
  return defaultWorkOrderSettings();
}

/** Callers check settings.manage. */
export async function saveWorkOrderSettings(raw: unknown, actor: Actor): Promise<WorkOrderSettings> {
  const next = workOrderSettingsSchema.parse(raw);
  const before = await getWorkOrderSettings();
  await setSetting(WORK_ORDER_SETTING_KEY, next, actor.id);
  await audit({ actorId: actor.id, action: "settings.work_orders", entityType: "settings", entityId: WORK_ORDER_SETTING_KEY, before, after: next });
  return next;
}

/** The office line printed on every work order ("Questions? Call the office"). */
export async function officeContact(): Promise<{ name: string; phone: string | null }> {
  const c = await getCompany();
  return { name: (c.displayName || c.name || "").trim(), phone: c.phone?.trim() || null };
}

// ---------------------------------------------------------------------------
// Source data for the view builder
// ---------------------------------------------------------------------------

const projectColumns = {
  id: projects.id,
  number: projects.number,
  name: projects.name,
  status: projects.status,
  customerId: projects.customerId,
  propertyId: projects.propertyId,
  estimateId: projects.estimateId,
  proposalId: projects.proposalId,
  projectManagerId: projects.projectManagerId,
};

async function loadProject(projectId: string) {
  if (!UUID_RE.test(projectId)) return null;
  const [p] = await db.select(projectColumns).from(projects).where(eq(projects.id, projectId)).limit(1);
  return p ?? null;
}
type ProjectRow = NonNullable<Awaited<ReturnType<typeof loadProject>>>;

/** The signed estimate: the accepted proposal's snapshot with the customer's choices, else the accepted estimate. */
async function signedDoc(p: ProjectRow): Promise<EstimateDoc | null> {
  if (p.proposalId) {
    const [pr] = await db
      .select({ snapshot: proposals.snapshot, selected: proposals.selectedOptionIds })
      .from(proposals)
      .where(and(eq(proposals.id, p.proposalId), eq(proposals.status, "accepted")))
      .limit(1);
    if (pr) {
      const doc = pr.snapshot as EstimateDoc;
      const chosen = new Set(pr.selected ?? []);
      return { ...doc, lines: doc.lines.map((l) => (l.isOptional ? { ...l, optionSelected: chosen.has(l.id) } : l)) };
    }
  }
  if (p.estimateId) {
    const loaded = await loadEstimate(p.estimateId);
    if (loaded?.estimate.status === "accepted") return loaded.doc;
  }
  return null;
}

/**
 * Jobs brought over from another system have no signed estimate. Their work order
 * carries no scope, preparation or exclusions, only what staff write on it. Only
 * the fields the view builder reads are set: there is no estimate to copy from.
 */
function unsignedDoc(projectName: string): EstimateDoc {
  return { title: jobTitle(projectName), jobType: "default", areasExcluded: "", preparationOverride: "", areas: [], lines: [], costItems: [] } as unknown as EstimateDoc;
}

async function propertyFor(propertyId: string | null) {
  if (!propertyId) return null;
  const [row] = await db
    .select({ street: properties.street, unit: properties.unit, city: properties.city, province: properties.province, postalCode: properties.postalCode, accessNotes: properties.accessNotes })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row ?? null;
}

/** The project's bookings with their working-day counts (crew Saturdays and closed days respected). */
async function bookingsFor(projectId: string): Promise<WorkOrderInput["bookings"]> {
  const rows = await db
    .select({
      kind: scheduleEntries.kind,
      phaseLabel: scheduleEntries.phaseLabel,
      startDate: scheduleEntries.startDate,
      endDate: scheduleEntries.endDate,
      crewId: scheduleEntries.crewId,
      crewName: crews.name,
      worksSaturdays: crews.worksSaturdays,
      crewNotes: scheduleEntries.crewNotes,
    })
    .from(scheduleEntries)
    .leftJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .where(and(eq(scheduleEntries.projectId, projectId), isNull(scheduleEntries.deletedAt)))
    .orderBy(asc(scheduleEntries.startDate), asc(scheduleEntries.id));
  if (!rows.length) return [];
  const settings = await getScheduleSettings();
  const first = rows.reduce((m, r) => (r.startDate < m ? r.startDate : m), rows[0].startDate);
  const last = rows.reduce((m, r) => (r.endDate > m ? r.endDate : m), rows[0].endDate);
  const { calFor } = calendarsFor(settings, first, last);
  return rows.map((r) => ({
    kind: r.kind,
    phaseLabel: r.phaseLabel,
    startDate: r.startDate,
    endDate: r.endDate,
    workDays: countWorkingDays(r.startDate, r.endDate, calFor(r.crewId ? { worksSaturdays: !!r.worksSaturdays } : null)),
    crewId: r.crewId,
    crewName: r.crewName ?? null,
    crewNotes: r.crewNotes,
  }));
}

type Sources = Omit<WorkOrderInput, "workOrder" | "version" | "issuedAt" | "crew"> & { signed: boolean };

async function loadSources(p: ProjectRow): Promise<Sources> {
  const [doc, customerRows, contactRows, property, bookings, pmRows, company, template, settings] = await Promise.all([
    signedDoc(p),
    db.select({ name: customers.displayName, phone: customers.phone }).from(customers).where(eq(customers.id, p.customerId)).limit(1),
    db.select({ phone: contacts.phone }).from(contacts).where(and(eq(contacts.customerId, p.customerId), eq(contacts.isPrimary, true))).limit(1),
    propertyFor(p.propertyId),
    bookingsFor(p.id),
    p.projectManagerId ? db.select({ name: user.name, phone: user.phone }).from(user).where(eq(user.id, p.projectManagerId)).limit(1) : Promise.resolve([]),
    getCompany(),
    getProposalTemplate(),
    getWorkOrderSettings(),
  ]);
  const customer = customerRows[0];
  if (!customer) throw new WorkOrderError("The customer for this job no longer exists.");
  const pm = pmRows[0];
  return {
    signed: !!doc,
    projectNumber: p.number ?? 0,
    doc: doc ?? unsignedDoc(p.name),
    template,
    company: { name: company.name, displayName: company.displayName, phone: company.phone },
    customer: { name: customer.name, phone: contactRows[0]?.phone?.trim() || customer.phone?.trim() || null },
    property,
    bookings,
    projectManager: pm ? { name: pm.name, phone: pm.phone } : null,
    // Hours and paint come from the signed estimate only; a job without one has neither.
    show: { hours: !!doc && settings.showHours, paint: !!doc && settings.showPaint },
  };
}

async function crewFor(crewId: string | null): Promise<WorkOrderInput["crew"]> {
  if (!crewId) return null;
  const [c] = await db.select({ name: crews.name }).from(crews).where(eq(crews.id, crewId)).limit(1);
  if (!c) return null;
  const [lead] = await db
    .select({ name: user.name })
    .from(crewMembers)
    .innerJoin(user, eq(user.id, crewMembers.userId))
    .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.isLead, true)))
    .limit(1);
  return { name: c.name, lead: lead?.name ?? null };
}

function buildFor(wo: WorkOrderRow, { signed, ...s }: Sources, crew: WorkOrderInput["crew"], version: number, issuedAt: Date): WorkOrderView {
  const view = buildWorkOrderView({
    ...s,
    crew,
    version,
    issuedAt,
    workOrder: {
      number: wo.number ?? 0,
      title: wo.title,
      specialInstructions: wo.specialInstructions,
      equipment: wo.equipment,
      safetyNotes: wo.safetyNotes,
      accessNotes: wo.accessNotes,
      showCustomerPhone: wo.showCustomerPhone,
      checklist: wo.checklist ?? [],
      crewId: wo.crewId,
    },
  });
  // The template's standard preparation describes estimated work; without an estimate it would be guesswork.
  return signed ? view : { ...view, preparation: [] };
}

function asView(v: unknown): WorkOrderView | null {
  return v && typeof v === "object" && (v as { viewVersion?: unknown }).viewVersion === 1 ? (v as WorkOrderView) : null;
}

async function versionViews(workOrderId: string, versions: number[], t: Tx | typeof db = db): Promise<Map<number, WorkOrderView>> {
  const wanted = [...new Set(versions.filter((v) => Number.isInteger(v) && v >= 1))];
  const out = new Map<number, WorkOrderView>();
  if (!wanted.length) return out;
  const rows = await t
    .select({ version: workOrderVersions.version, view: workOrderVersions.view })
    .from(workOrderVersions)
    .where(and(eq(workOrderVersions.workOrderId, workOrderId), inArray(workOrderVersions.version, wanted)));
  for (const r of rows) {
    const v = asView(r.view);
    if (v) out.set(r.version, v);
  }
  return out;
}

/** The crew only gets an override when it differs from what the property already says. */
function accessOverride(submitted: string | null, propertyNotes: string | null | undefined): string | null {
  if (!submitted) return null;
  return submitted.trim() === (propertyNotes ?? "").trim() ? null : submitted;
}

async function assertCrew(crewId: string) {
  const [c] = await db.select({ id: crews.id, active: crews.active }).from(crews).where(eq(crews.id, crewId)).limit(1);
  if (!c) throw new WorkOrderError("That crew no longer exists. Pick another one.");
  if (!c.active) throw new WorkOrderError("That crew is inactive. Pick another one.");
}

// ---------------------------------------------------------------------------
// Staff: list, defaults, create, edit, issue, cancel, links
// ---------------------------------------------------------------------------

/** What a new work order's form starts with: the job name, the property's access notes and the default checklist. */
export async function newWorkOrderDefaults(projectId: string): Promise<NewWorkOrderDefaults | null> {
  const p = await loadProject(projectId);
  if (!p) return null;
  const [property, settings, doc] = await Promise.all([propertyFor(p.propertyId), getWorkOrderSettings(), signedDoc(p)]);
  return {
    hasSignedEstimate: !!doc,
    title: p.name,
    accessNotes: property?.accessNotes?.trim() ?? "",
    checklist: settings.defaultChecklist.map((text) => ({ id: randomUUID(), text })),
    linkDays: settings.defaultLinkDays,
  };
}

/** The project's work orders for the staff card, newest first. */
export async function listWorkOrders(projectId: string, now: Date = new Date()): Promise<WorkOrderDTO[]> {
  const p = await loadProject(projectId);
  if (!p) return [];
  const rows = await db.select().from(workOrders).where(eq(workOrders.projectId, p.id)).orderBy(desc(workOrders.number));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const crewIds = [...new Set(rows.map((r) => r.crewId).filter((c): c is string => !!c))];
  const [crewRows, versionRows, linkRows, property] = await Promise.all([
    crewIds.length ? db.select({ id: crews.id, name: crews.name }).from(crews).where(inArray(crews.id, crewIds)) : Promise.resolve([]),
    db
      .select({ workOrderId: workOrderVersions.workOrderId, version: workOrderVersions.version, issuedAt: workOrderVersions.issuedAt, changeNote: workOrderVersions.changeNote, issuedByName: user.name })
      .from(workOrderVersions)
      .leftJoin(user, eq(user.id, workOrderVersions.issuedBy))
      .where(inArray(workOrderVersions.workOrderId, ids))
      .orderBy(desc(workOrderVersions.version)),
    // Never the token hash: it isn't needed and doesn't leave this module.
    db
      .select({
        id: workOrderLinks.id,
        workOrderId: workOrderLinks.workOrderId,
        label: workOrderLinks.label,
        createdAt: workOrderLinks.createdAt,
        expiresAt: workOrderLinks.expiresAt,
        revokedAt: workOrderLinks.revokedAt,
        openCount: workOrderLinks.openCount,
        lastOpenedAt: workOrderLinks.lastOpenedAt,
        lastOpenedVersion: workOrderLinks.lastOpenedVersion,
      })
      .from(workOrderLinks)
      .where(inArray(workOrderLinks.workOrderId, ids))
      .orderBy(desc(workOrderLinks.createdAt)),
    propertyFor(p.propertyId),
  ]);
  const crewName = new Map(crewRows.map((c) => [c.id, c.name]));
  const booked = await db
    .select({ kind: scheduleEntries.kind, crewId: scheduleEntries.crewId, crewName: crews.name, startDate: scheduleEntries.startDate, endDate: scheduleEntries.endDate })
    .from(scheduleEntries)
    .leftJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .where(and(eq(scheduleEntries.projectId, p.id), isNull(scheduleEntries.deletedAt)))
    .orderBy(asc(scheduleEntries.startDate), asc(scheduleEntries.id));

  // What would change if each issued work order were issued again now.
  const issued = rows.filter((r) => r.status === "issued" && r.currentVersion > 0);
  const pending = new Map<string, WorkOrderSection[] | null>();
  if (issued.length) {
    try {
      const sources = await loadSources(p);
      const crewInfo = new Map<string | null, WorkOrderInput["crew"]>();
      for (const wo of issued) {
        if (!crewInfo.has(wo.crewId)) crewInfo.set(wo.crewId, await crewFor(wo.crewId));
        const current = (await versionViews(wo.id, [wo.currentVersion])).get(wo.currentVersion);
        pending.set(wo.id, current ? changedSections(current, buildFor(wo, sources, crewInfo.get(wo.crewId) ?? null, wo.currentVersion + 1, now)) : null);
      }
    } catch (e) {
      console.error("[work-orders] could not compare with the issued versions", e);
    }
  }

  return rows.map((wo) => {
    const versions = versionRows.filter((v) => v.workOrderId === wo.id);
    const fields: WorkOrderFieldsDTO = {
      title: wo.title,
      crewId: wo.crewId,
      specialInstructions: wo.specialInstructions ?? "",
      equipment: wo.equipment ?? "",
      safetyNotes: wo.safetyNotes ?? "",
      accessNotes: wo.accessNotes ?? property?.accessNotes?.trim() ?? "",
      showCustomerPhone: wo.showCustomerPhone,
      checklist: (wo.checklist ?? []).map((c) => ({ id: c.id, text: c.text })),
    };
    return {
      id: wo.id,
      number: workOrderNumber(wo.number ?? 0),
      title: wo.title,
      status: wo.status,
      currentVersion: wo.currentVersion,
      crewId: wo.crewId,
      crewName: wo.crewId ? (crewName.get(wo.crewId) ?? "Crew removed") : null,
      issuedAt: versions.find((v) => v.version === wo.currentVersion)?.issuedAt.toISOString() ?? null,
      fields,
      assigned: booked
        .filter((b) => !wo.crewId || b.crewId === wo.crewId)
        .map((b) => ({ what: kindLabel(b.kind), who: b.crewName ?? null, dates: dateRangeLabel(b.startDate, b.endDate) })),
      versions: versions.map((v) => ({ version: v.version, issuedAt: v.issuedAt.toISOString(), issuedByName: v.issuedByName ?? null, changeNote: v.changeNote })),
      links: linkRows
        .filter((l) => l.workOrderId === wo.id)
        .map((l) => ({
          id: l.id,
          label: l.label,
          createdAt: l.createdAt.toISOString(),
          expiresAt: l.expiresAt.toISOString(),
          revokedAt: l.revokedAt?.toISOString() ?? null,
          status: linkStatus(l, now),
          openCount: l.openCount,
          lastOpenedAt: l.lastOpenedAt?.toISOString() ?? null,
          lastOpenedVersion: l.lastOpenedVersion,
        })),
      pendingChanges: pending.get(wo.id) ?? null,
    };
  });
}

const EDITABLE = ["title", "crewId", "specialInstructions", "equipment", "safetyNotes", "accessNotes", "showCustomerPhone", "checklist"] as const;

export async function createWorkOrder(raw: unknown, actor: Actor): Promise<{ id: string; projectId: string }> {
  const input = createWorkOrderSchema.parse(raw);
  const p = await loadProject(input.projectId);
  if (!p) throw new WorkOrderError("This job no longer exists.");
  if (p.status === "cancelled") throw new WorkOrderError(CANCELLED_JOB);
  if (input.crewId) await assertCrew(input.crewId);
  const property = await propertyFor(p.propertyId);
  const values = {
    title: input.title,
    crewId: input.crewId,
    specialInstructions: input.specialInstructions,
    equipment: input.equipment,
    safetyNotes: input.safetyNotes,
    accessNotes: accessOverride(input.accessNotes, property?.accessNotes),
    showCustomerPhone: input.showCustomerPhone,
    checklist: input.checklist,
  };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(workOrders)
      .values({ projectId: p.id, ...values, createdBy: actor.id })
      .returning({ id: workOrders.id, number: workOrders.number });
    await audit({ actorId: actor.id, action: "work_order.create", entityType: "work_order", entityId: row.id, after: { projectId: p.id, number: row.number, ...values } }, tx);
    return { id: row.id, projectId: p.id };
  });
}

/**
 * The draft work order a sold job starts with (when the `createOnSale` setting is on): for
 * every crew booked on the job, with the default checklist. Staff check it and issue it;
 * crews only see issued versions. Never throws: a sale must not fail because of it.
 */
export async function createWorkOrderForSale(projectId: string, actorId: string | null): Promise<string | null> {
  try {
    const settings = await getWorkOrderSettings();
    if (!settings.createOnSale) return null;
    const p = await loadProject(projectId);
    if (!p || p.status === "cancelled") return null;
    const [existing] = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.projectId, p.id)).limit(1);
    if (existing) return null;
    const values = { title: p.name, crewId: null, checklist: settings.defaultChecklist.map((text) => ({ id: randomUUID(), text })) };
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(workOrders)
        .values({ projectId: p.id, ...values, createdBy: actorId })
        .returning({ id: workOrders.id, number: workOrders.number });
      await audit({ actorId, action: "work_order.create", entityType: "work_order", entityId: row.id, after: { projectId: p.id, number: row.number, automatic: true, ...values } }, tx);
      return row.id;
    });
  } catch (e) {
    console.error("[work-orders] could not create the work order for a sale", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function updateWorkOrder(raw: unknown, actor: Actor): Promise<{ id: string; projectId: string }> {
  const input = updateWorkOrderSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, input.id)).for("update");
    if (!wo) throw new WorkOrderError(NOT_FOUND);
    if (wo.status === "cancelled") throw new WorkOrderError(CANCELLED_WO);
    if (input.crewId && input.crewId !== wo.crewId) await assertCrew(input.crewId);
    const p = await loadProject(wo.projectId);
    const property = await propertyFor(p?.propertyId ?? null);
    const values = {
      title: input.title,
      crewId: input.crewId,
      specialInstructions: input.specialInstructions,
      equipment: input.equipment,
      safetyNotes: input.safetyNotes,
      accessNotes: accessOverride(input.accessNotes, property?.accessNotes),
      showCustomerPhone: input.showCustomerPhone,
      checklist: input.checklist,
    };
    await tx
      .update(workOrders)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(workOrders.id, wo.id));
    const before = Object.fromEntries(EDITABLE.map((k) => [k, wo[k]]));
    await audit({ actorId: actor.id, action: "work_order.update", entityType: "work_order", entityId: wo.id, before, after: values }, tx);
    return { id: wo.id, projectId: wo.projectId };
  });
}

/** Freeze what the crew sees now as the next version. Refused when nothing changed since the current one. */
export async function issueWorkOrder(raw: unknown, actor: Actor): Promise<{ id: string; projectId: string; version: number }> {
  const input = issueWorkOrderSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, input.id)).for("update");
    if (!wo) throw new WorkOrderError(NOT_FOUND);
    if (wo.status === "cancelled") throw new WorkOrderError(CANCELLED_WO);
    const p = await loadProject(wo.projectId);
    if (!p) throw new WorkOrderError(NOT_FOUND);
    if (p.status === "cancelled") throw new WorkOrderError(CANCELLED_JOB);
    const now = new Date();
    const version = wo.currentVersion + 1;
    const view = buildFor(wo, await loadSources(p), await crewFor(wo.crewId), version, now);
    let changed: WorkOrderSection[] = [];
    if (wo.currentVersion > 0) {
      const previous = (await versionViews(wo.id, [wo.currentVersion], tx)).get(wo.currentVersion);
      changed = previous ? changedSections(previous, view) : [];
      if (previous && !changed.length) throw new WorkOrderError(`Nothing has changed since version ${wo.currentVersion}, so there's nothing new to issue.`);
    }
    await tx.insert(workOrderVersions).values({ workOrderId: wo.id, version, view, changeNote: input.changeNote, issuedBy: actor.id, issuedAt: now });
    await tx.update(workOrders).set({ status: "issued", currentVersion: version, updatedAt: now }).where(eq(workOrders.id, wo.id));
    await audit(
      { actorId: actor.id, action: "work_order.issue", entityType: "work_order", entityId: wo.id, before: { status: wo.status, version: wo.currentVersion }, after: { status: "issued", version, changeNote: input.changeNote, changed } },
      tx,
    );
    return { id: wo.id, projectId: wo.projectId, version };
  });
}

/** Crews lose access at once (share links and /my-jobs only show issued work orders). Versions and links are kept. */
export async function cancelWorkOrder(raw: unknown, actor: Actor): Promise<{ id: string; projectId: string }> {
  const { id } = workOrderIdSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [wo] = await tx.select({ id: workOrders.id, projectId: workOrders.projectId, status: workOrders.status }).from(workOrders).where(eq(workOrders.id, id)).for("update");
    if (!wo) throw new WorkOrderError(NOT_FOUND);
    if (wo.status !== "cancelled") {
      await tx.update(workOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(workOrders.id, id));
      await audit({ actorId: actor.id, action: "work_order.cancel", entityType: "work_order", entityId: id, before: { status: wo.status }, after: { status: "cancelled" } }, tx);
    }
    return { id: wo.id, projectId: wo.projectId };
  });
}

/** A new share link. The returned url holds the only copy of the token. */
export async function createShareLink(raw: unknown, actor: Actor, now: Date = new Date()): Promise<{ linkId: string; projectId: string; url: string; expiresAt: string }> {
  const input = createLinkSchema.parse(raw);
  const [wo] = await db.select({ id: workOrders.id, projectId: workOrders.projectId, status: workOrders.status }).from(workOrders).where(eq(workOrders.id, input.workOrderId)).limit(1);
  if (!wo) throw new WorkOrderError(NOT_FOUND);
  if (wo.status === "cancelled") throw new WorkOrderError(CANCELLED_WO);
  if (wo.status !== "issued") throw new WorkOrderError("Issue the work order first. Crews only ever see issued versions.");
  const { token, tokenHash } = newLinkToken();
  const expiresAt = linkExpiresAt(now, input.days);
  const linkId = await db.transaction(async (tx) => {
    const [link] = await tx.insert(workOrderLinks).values({ workOrderId: wo.id, tokenHash, label: input.label, expiresAt, createdBy: actor.id, createdAt: now }).returning({ id: workOrderLinks.id });
    await audit({ actorId: actor.id, action: "work_order.link_create", entityType: "work_order_link", entityId: link.id, after: { workOrderId: wo.id, label: input.label, expiresAt: expiresAt.toISOString() } }, tx);
    return link.id;
  });
  return { linkId, projectId: wo.projectId, url: workOrderLinkUrl(token), expiresAt: expiresAt.toISOString() };
}

export async function revokeShareLink(raw: unknown, actor: Actor): Promise<{ projectId: string }> {
  const { linkId } = revokeLinkSchema.parse(raw);
  const [link] = await db
    .select({ id: workOrderLinks.id, workOrderId: workOrderLinks.workOrderId, label: workOrderLinks.label, revokedAt: workOrderLinks.revokedAt, projectId: workOrders.projectId })
    .from(workOrderLinks)
    .innerJoin(workOrders, eq(workOrders.id, workOrderLinks.workOrderId))
    .where(eq(workOrderLinks.id, linkId))
    .limit(1);
  if (!link) throw new WorkOrderError("That link no longer exists. Refresh the page.");
  if (!link.revokedAt) {
    await db.transaction(async (tx) => {
      await tx.update(workOrderLinks).set({ revokedAt: new Date() }).where(and(eq(workOrderLinks.id, link.id), isNull(workOrderLinks.revokedAt)));
      await audit({ actorId: actor.id, action: "work_order.link_revoke", entityType: "work_order_link", entityId: link.id, after: { workOrderId: link.workOrderId, label: link.label } }, tx);
    });
  }
  return { projectId: link.projectId };
}

// ---------------------------------------------------------------------------
// Reading an issued work order (staff preview, share link, /my-jobs)
// ---------------------------------------------------------------------------

export interface WorkOrderUpdate {
  /** The version this viewer saw last. */
  fromVersion: number;
  changed: WorkOrderSection[];
}

export interface CrewWorkOrder {
  view: WorkOrderView;
  /** Set when the viewer last saw an older version. */
  update: WorkOrderUpdate | null;
}

/** The current version, and what changed since `seenVersion` when that is older. */
async function currentWithUpdate(workOrderId: string, currentVersion: number, seenVersion: number | null | undefined): Promise<CrewWorkOrder | null> {
  const seen = seenVersion && Number.isInteger(seenVersion) && seenVersion >= 1 && seenVersion < currentVersion ? seenVersion : null;
  const views = await versionViews(workOrderId, seen ? [currentVersion, seen] : [currentVersion]);
  const view = views.get(currentVersion);
  if (!view) return null;
  const before = seen ? views.get(seen) : undefined;
  return { view, update: seen && before ? { fromVersion: seen, changed: changedSections(before, view) } : null };
}

/**
 * Public share-link lookup. Null for a malformed, unknown, revoked or expired link,
 * or when the work order isn't issued (draft or cancelled) or the job was cancelled.
 * Opens are counted unless `countOpen` is false (signed-in staff).
 */
export async function getWorkOrderForToken(token: string, opts: { countOpen: boolean; now?: Date }): Promise<CrewWorkOrder | null> {
  if (typeof token !== "string" || !isLinkTokenShaped(token)) return null;
  const now = opts.now ?? new Date();
  const [row] = await db
    .select({
      linkId: workOrderLinks.id,
      tokenHash: workOrderLinks.tokenHash,
      expiresAt: workOrderLinks.expiresAt,
      revokedAt: workOrderLinks.revokedAt,
      lastOpenedVersion: workOrderLinks.lastOpenedVersion,
      workOrderId: workOrders.id,
      status: workOrders.status,
      currentVersion: workOrders.currentVersion,
      projectStatus: projects.status,
    })
    .from(workOrderLinks)
    .innerJoin(workOrders, eq(workOrders.id, workOrderLinks.workOrderId))
    .innerJoin(projects, eq(projects.id, workOrders.projectId))
    .where(eq(workOrderLinks.tokenHash, hashLinkToken(token)))
    .limit(1);
  if (!row || !tokenMatches(token, row.tokenHash)) return null;
  if (linkStatus(row, now) !== "active" || row.status !== "issued" || row.currentVersion < 1 || row.projectStatus === "cancelled") return null;

  const result = await currentWithUpdate(row.workOrderId, row.currentVersion, row.lastOpenedVersion);
  if (!result) return null;
  if (opts.countOpen) {
    await db
      .update(workOrderLinks)
      .set({ openCount: sql`${workOrderLinks.openCount} + 1`, lastOpenedAt: now, lastOpenedVersion: row.currentVersion })
      .where(and(eq(workOrderLinks.id, row.linkId), isNull(workOrderLinks.revokedAt)));
  }
  return result;
}

export interface CrewWorkOrderRef {
  id: string;
  /** "WO-7001". */
  number: string;
  title: string;
  version: number;
  projectId: string;
  /** Null = all crews on the job. */
  crewId: string | null;
}

/**
 * Issued work orders a crew member can open from /my-jobs: those for any of their
 * active crews, and all-crews ones on jobs where one of their crews is booked.
 */
export async function workOrdersForCrewMember(userId: string): Promise<CrewWorkOrderRef[]> {
  const memberships = await crewIdsForUser(userId);
  if (!memberships.length) return [];
  const crewIds = memberships.map((m) => m.crewId);
  const booked = await db
    .select({ projectId: scheduleEntries.projectId })
    .from(scheduleEntries)
    .where(and(inArray(scheduleEntries.crewId, crewIds), isNull(scheduleEntries.deletedAt)));
  const bookedProjects = [...new Set(booked.map((b) => b.projectId))];
  const covers = bookedProjects.length
    ? or(inArray(workOrders.crewId, crewIds), and(isNull(workOrders.crewId), inArray(workOrders.projectId, bookedProjects)))
    : inArray(workOrders.crewId, crewIds);
  const rows = await db
    .select({ id: workOrders.id, number: workOrders.number, title: workOrders.title, version: workOrders.currentVersion, projectId: workOrders.projectId, crewId: workOrders.crewId })
    .from(workOrders)
    .innerJoin(projects, eq(projects.id, workOrders.projectId))
    .where(and(eq(workOrders.status, "issued"), ne(projects.status, "cancelled"), covers))
    .orderBy(desc(workOrders.number))
    .limit(500);
  return rows.map((r) => ({ id: r.id, number: workOrderNumber(r.number ?? 0), title: r.title, version: r.version, projectId: r.projectId, crewId: r.crewId }));
}

/**
 * For /my-jobs cards: booking id → the work order to open. A work order for the
 * booking's crew wins over an all-crews one; the newest wins among equals.
 * Bookings without an issued work order are left out.
 */
export async function workOrderIdsForFieldJobs(viewer: { id: string }, entryIds: readonly string[]): Promise<Record<string, string>> {
  const ids = [...new Set(entryIds.filter((id) => UUID_RE.test(id)))].slice(0, 500);
  if (!viewer.id || !ids.length) return {};
  const refs = await workOrdersForCrewMember(viewer.id);
  if (!refs.length) return {};
  const entries = await db
    .select({ id: scheduleEntries.id, projectId: scheduleEntries.projectId, crewId: scheduleEntries.crewId })
    .from(scheduleEntries)
    .where(and(inArray(scheduleEntries.id, ids), isNull(scheduleEntries.deletedAt)));
  const out: Record<string, string> = {};
  for (const e of entries) {
    if (!e.crewId) continue;
    const own = refs.find((r) => r.projectId === e.projectId && r.crewId === e.crewId);
    const all = refs.find((r) => r.projectId === e.projectId && r.crewId === null);
    const pick = own ?? all;
    if (pick) out[e.id] = pick.id;
  }
  return out;
}

/**
 * /my-jobs/work-orders/[id] for a crew member: the current issued version when one
 * of their crews is covered. Only a crew lead gets the customer's phone.
 */
export async function getWorkOrderForCrewMember(viewer: { id: string }, workOrderId: string, opts: { seenVersion?: number | null } = {}): Promise<(CrewWorkOrder & { isLead: boolean }) | null> {
  if (!viewer.id || !UUID_RE.test(workOrderId)) return null;
  const [wo] = await db
    .select({ id: workOrders.id, projectId: workOrders.projectId, crewId: workOrders.crewId, status: workOrders.status, currentVersion: workOrders.currentVersion, projectStatus: projects.status })
    .from(workOrders)
    .innerJoin(projects, eq(projects.id, workOrders.projectId))
    .where(eq(workOrders.id, workOrderId))
    .limit(1);
  if (!wo || wo.status !== "issued" || wo.currentVersion < 1 || wo.projectStatus === "cancelled") return null;
  const memberships = await crewIdsForUser(viewer.id);
  let isLead: boolean | null = null;
  if (wo.crewId) {
    const m = memberships.find((x) => x.crewId === wo.crewId);
    if (m) isLead = m.isLead;
  } else if (memberships.length) {
    const booked = await db
      .select({ crewId: scheduleEntries.crewId })
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.projectId, wo.projectId), inArray(scheduleEntries.crewId, memberships.map((m) => m.crewId)), isNull(scheduleEntries.deletedAt)));
    const bookedCrews = new Set(booked.map((b) => b.crewId));
    const mine = memberships.filter((m) => bookedCrews.has(m.crewId));
    if (mine.length) isLead = mine.some((m) => m.isLead);
  }
  if (isLead === null) return null;
  const result = await currentWithUpdate(wo.id, wo.currentVersion, opts.seenVersion);
  if (!result) return null;
  return { view: isLead ? result.view : { ...result.view, customerPhone: null }, update: result.update, isLead };
}

export interface StaffWorkOrderView {
  id: string;
  projectId: string;
  projectNumber: number;
  number: string;
  status: WorkOrderStatus;
  currentVersion: number;
  versions: { version: number; issuedAt: string }[];
  /** "draft" = what issuing now would produce (built live, not saved). */
  shown: { kind: "draft"; version: number } | { kind: "version"; version: number };
  view: WorkOrderView;
  /** Sections that differ from `comparedWith`. */
  changed: WorkOrderSection[];
  comparedWith: number | null;
}

/**
 * Staff preview: an issued version (`version`), or the draft of the next version
 * (`draft`, or when nothing has been issued yet). Defaults to the current version.
 */
export async function getWorkOrderForStaff(workOrderId: string, opts: { version?: number | null; draft?: boolean } = {}, now: Date = new Date()): Promise<StaffWorkOrderView | null> {
  if (!UUID_RE.test(workOrderId)) return null;
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId)).limit(1);
  if (!wo) return null;
  const p = await loadProject(wo.projectId);
  if (!p) return null;
  const versionRows = await db
    .select({ version: workOrderVersions.version, issuedAt: workOrderVersions.issuedAt })
    .from(workOrderVersions)
    .where(eq(workOrderVersions.workOrderId, wo.id))
    .orderBy(desc(workOrderVersions.version));
  const versions = versionRows.map((v) => ({ version: v.version, issuedAt: v.issuedAt.toISOString() }));
  const base = { id: wo.id, projectId: wo.projectId, projectNumber: p.number ?? 0, number: workOrderNumber(wo.number ?? 0), status: wo.status, currentVersion: wo.currentVersion, versions };

  const asked = opts.version && versionRows.some((v) => v.version === opts.version) ? opts.version : null;
  const wantDraft = !asked && wo.status !== "cancelled" && (opts.draft || wo.currentVersion === 0);
  if (wantDraft) {
    const view = buildFor(wo, await loadSources(p), await crewFor(wo.crewId), wo.currentVersion + 1, now);
    const current = wo.currentVersion > 0 ? (await versionViews(wo.id, [wo.currentVersion])).get(wo.currentVersion) : undefined;
    return { ...base, shown: { kind: "draft", version: wo.currentVersion + 1 }, view, changed: current ? changedSections(current, view) : [], comparedWith: current ? wo.currentVersion : null };
  }
  const version = asked ?? (wo.currentVersion || versionRows[0]?.version || 0);
  if (!version) return null;
  const views = await versionViews(wo.id, [version, version - 1]);
  const view = views.get(version);
  if (!view) return null;
  const before = views.get(version - 1);
  return { ...base, shown: { kind: "version", version }, view, changed: before ? changedSections(before, view) : [], comparedWith: before ? version - 1 : null };
}

export interface WorkOrderListRow {
  id: string;
  /** "WO-7001". */
  number: string;
  title: string;
  status: WorkOrderStatus;
  currentVersion: number;
  crewName: string | null;
  projectId: string;
  projectNumber: number;
  customerName: string;
  /** When the current version was issued (ISO). */
  issuedAt: string | null;
  /** Share links that still work. */
  activeLinks: number;
  updatedAt: string;
}

/** Every work order, newest first, for the Work orders page (staff with projects.read_all). */
export async function listAllWorkOrders(opts: { status?: WorkOrderStatus } = {}, now: Date = new Date()): Promise<WorkOrderListRow[]> {
  const issuedAt = sql<Date | null>`(select max(${workOrderVersions.issuedAt}) from ${workOrderVersions}
    where ${workOrderVersions.workOrderId} = ${outer(workOrders.id)} and ${workOrderVersions.version} = ${outer(workOrders.currentVersion)})`;
  const activeLinks = sql<number>`(select count(*)::int from ${workOrderLinks}
    where ${workOrderLinks.workOrderId} = ${outer(workOrders.id)} and ${workOrderLinks.revokedAt} is null and ${workOrderLinks.expiresAt} > ${now})`;
  const rows = await db
    .select({
      id: workOrders.id,
      number: workOrders.number,
      title: workOrders.title,
      status: workOrders.status,
      currentVersion: workOrders.currentVersion,
      crewName: crews.name,
      projectId: projects.id,
      projectNumber: projects.number,
      customerName: customers.displayName,
      issuedAt,
      activeLinks,
      updatedAt: workOrders.updatedAt,
    })
    .from(workOrders)
    .innerJoin(projects, eq(projects.id, workOrders.projectId))
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(crews, eq(crews.id, workOrders.crewId))
    .where(opts.status ? eq(workOrders.status, opts.status) : undefined)
    .orderBy(desc(workOrders.updatedAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    number: workOrderNumber(r.number),
    title: r.title,
    status: r.status,
    currentVersion: r.currentVersion,
    crewName: r.crewName,
    projectId: r.projectId,
    projectNumber: r.projectNumber,
    customerName: r.customerName,
    issuedAt: r.issuedAt ? new Date(r.issuedAt).toISOString() : null,
    activeLinks: Number(r.activeLinks) || 0,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

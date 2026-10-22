import "server-only";
import { and, desc, eq, gt, isNull, like, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { inboundEvents } from "@/db/schema";
import { cleanInboundLead, identifiesPerson, type CleanLead, type InboundLead } from "@/lib/pipeline/lead-input";
import { parseBusinessDateTime } from "@/lib/time";
import { formatDateTime, fullName } from "@/lib/utils";
import { audit } from "./audit";
import { bookingEvent, bookingKey, parseLenientJsonObject, payloadToLead, unreadableText } from "./inbound";
import { cancelBooking, ingestLead, type CancelResult, type IngestResult } from "./leads";
import { notify, notifyLater, officeRecipients, type NewNotification } from "./notifications";

/**
 * Website form submissions and YouCanBook.me bookings. Each one is stored before it is
 * processed, so nothing is lost: what can't be imported is listed under Leads →
 * "Couldn't import" with Retry and Dismiss, and the office is told either way.
 */

type Payload = Record<string, unknown>;
type InboundRow = typeof inboundEvents.$inferSelect;

const SOURCE_LABEL: Record<string, string> = { website_form: "Website form", youcanbookme: "YouCanBook.me" };

/** Still "received" this long after arriving (or after a retry began) means processing was cut off. */
const STALLED_MS = 15 * 60_000;
const LIST_LIMIT = 100;
const UNREADABLE = "What was sent couldn't be read, so there are no details to import.";

/** Failed, or cut off part-way: what "Couldn't import" lists. */
function needsAttention(now: Date) {
  const cutoff = new Date(now.getTime() - STALLED_MS).toISOString();
  return or(
    eq(inboundEvents.status, "failed"),
    and(eq(inboundEvents.status, "received"), sql`coalesce(${inboundEvents.processedAt}, ${inboundEvents.receivedAt}) < ${cutoff}::timestamptz`),
  );
}

/** A problem with the submission itself, worded for the office. */
class ImportProblem extends Error {
  readonly expose = true;
  readonly unreadable: boolean;
  constructor(message: string, opts: { unreadable?: boolean } = {}) {
    super(message);
    this.unreadable = !!opts.unreadable;
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string | null | undefined, n = 140) => (s ? clip(s.replace(/\s+/g, " ").trim(), n) : null);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function readPayload(stored: unknown): Payload {
  const text = unreadableText(stored);
  if (text === null) return stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Payload) : {};
  const again = parseLenientJsonObject(text);
  if (!again) throw new ImportProblem(UNREADABLE, { unreadable: true });
  return again;
}

/** The payload as a lead, for showing who it was from; empty when it can't be read. */
function peekLead(stored: unknown): InboundLead {
  try {
    return payloadToLead(readPayload(stored));
  } catch {
    return {};
  }
}

/** "Jane Doe", or the email or phone when there's no name. */
function who(lead: InboundLead): string | null {
  return fullName(lead.firstName, lead.lastName) || lead.company || lead.email || lead.phone || null;
}

function bookingRefOf(ev: InboundRow): string | null {
  return ev.source === "youcanbookme" ? (peekLead(ev.payload).bookingRef ?? null) : null;
}

function unidentified(rawEmail: string | null | undefined): string {
  return rawEmail?.trim()
    ? `It has no name or phone number, and the email address "${clip(rawEmail.trim(), 80)}" isn't valid, so there's no way to tell who it's from.`
    : "It has no name, email or phone number, so there's no way to tell who it's from.";
}

// ---------------------------------------------------------------------------
// Notices: the office roles that hear about every lead (owner, admins,
// operations managers), plus the lead's estimator when there is one.
// ---------------------------------------------------------------------------

interface Notice {
  estimatorId: string | null;
  n: NewNotification;
}

async function tellOffice(notice: Notice | null, exceptId: string | null): Promise<void> {
  if (!notice) return;
  try {
    const recipients = await officeRecipients([notice.estimatorId], exceptId);
    await notify(
      recipients.map((u) => u.id),
      notice.n,
    );
  } catch (e) {
    console.error("[inbound] notice failed", notice.n.kind, e instanceof Error ? e.message : e);
  }
}

function leadNotice(source: string, r: IngestResult, lead: CleanLead): Notice {
  const base = { href: `/leads/${r.opportunityId}`, entityType: "opportunity", entityId: r.opportunityId };
  const about = [lead.projectTypes.join(", "), lead.city].filter(Boolean).join(" · ");
  if (source === "website_form") {
    const created = r.outcome === "created";
    return {
      estimatorId: r.estimatorId,
      n: {
        ...base,
        kind: "lead.web",
        title: created ? `New web lead: ${r.customerName}` : `${r.customerName} sent the website form again`,
        body: [created ? about : `Added to their open lead (${r.stageName})`, oneLine(lead.description)].filter(Boolean).join(" – ") || null,
      },
    };
  }
  const title =
    r.outcome === "reopened" ? `${r.customerName} booked again` : r.outcome === "booking_updated" ? `${r.customerName} changed their estimate visit` : `${r.customerName} booked an estimate visit`;
  const change = r.outcome === "reopened" ? `Their cancelled lead is open again in ${r.stageName}` : r.outcome === "promoted" ? `Their lead moved to ${r.stageName}` : null;
  return {
    estimatorId: r.estimatorId,
    n: { ...base, kind: "lead.booking", title, body: [r.visitAt ? `Visit ${formatDateTime(r.visitAt)}` : "No visit time given", change, about].filter(Boolean).join(" · ") },
  };
}

function cancelNotice(c: CancelResult, lead: CleanLead): Notice {
  const kind = "lead.booking_cancelled";
  if (!c.opportunityId) {
    const person = who(lead);
    return { estimatorId: null, n: { kind, title: "A YouCanBook.me booking was cancelled", body: `${person ? `${person}. ` : ""}No lead here matches it, so nothing changed.`, href: "/leads" } };
  }
  return {
    estimatorId: c.estimatorId,
    n: {
      kind,
      title: `${c.customerName ?? who(lead) ?? "A customer"} cancelled their estimate visit`,
      body: c.outcome === "lost" ? "The lead moved to Lost." : `The lead stays in ${c.stageName}. The cancellation is on its timeline.`,
      href: `/leads/${c.opportunityId}`,
      entityType: "opportunity",
      entityId: c.opportunityId,
    },
  };
}

function failureNotice(ev: InboundRow, reason: string): Notice {
  const person = who(peekLead(ev.payload));
  return {
    estimatorId: null,
    n: {
      kind: "lead.import_failed",
      title: ev.source === "youcanbookme" ? "A YouCanBook.me booking couldn't be imported" : "A website lead couldn't be imported",
      body: `${person ? `${person}: ` : ""}${reason}`,
      href: "/leads/not-imported",
      entityType: "inbound_event",
      entityId: ev.id,
    },
  };
}

// ---------------------------------------------------------------------------
// Processing: the same for a webhook as it arrives and for Retry.
// ---------------------------------------------------------------------------

interface Handled {
  opportunityId: string | null;
  reply: Record<string, unknown>;
  notice: Notice;
}

async function handle(source: string, stored: unknown): Promise<Handled> {
  if (source !== "website_form" && source !== "youcanbookme") throw new ImportProblem(`Submissions from "${source}" can't be imported.`);
  const payload = readPayload(stored);
  if (source === "youcanbookme" && bookingEvent(payload).includes("cancel")) return handleCancellation(payload);

  const raw = payloadToLead(payload);
  const lead = cleanInboundLead(raw);
  if (!identifiesPerson(lead)) throw new ImportProblem(unidentified(raw.email));
  const r =
    source === "youcanbookme"
      ? await ingestLead(lead, { stageKey: "estimate_booked", channel: "youcanbookme", externalSource: "youcanbookme", externalRef: lead.bookingRef })
      : await ingestLead(lead, { stageKey: "new_lead", channel: "website_form", externalSource: "website_form", matchOpenLead: true });
  return {
    opportunityId: r.opportunityId,
    reply: { opportunityId: r.opportunityId, customerId: r.customerId, created: r.created, matchedExistingCustomer: r.matchedExistingCustomer },
    notice: leadNotice(source, r, lead),
  };
}

async function handleCancellation(payload: Payload): Promise<Handled> {
  const lead = cleanInboundLead(payloadToLead(payload));
  if (!lead.bookingRef) throw new ImportProblem("It's a cancellation with no booking reference, so there's no way to tell which booking it was.");
  const c = await cancelBooking(lead.bookingRef);
  return { opportunityId: c.opportunityId, reply: { opportunityId: c.opportunityId, cancelled: !!c.opportunityId }, notice: cancelNotice(c, lead) };
}

function problemText(e: unknown): string {
  if (e instanceof ImportProblem) return e.message;
  console.error("[inbound] import failed", e);
  const detail = e instanceof Error ? e.message : String(e);
  return `Something went wrong while saving it (${clip(detail, 200)}). Try again in a few minutes.`;
}

async function markProcessed(ev: InboundRow, opportunityId: string | null) {
  const now = new Date();
  await db.update(inboundEvents).set({ status: "processed", error: null, opportunityId, processedAt: now }).where(eq(inboundEvents.id, ev.id));
  // Earlier deliveries of the same booking that failed are out of date now.
  const ref = bookingRefOf(ev);
  if (ref) {
    await db
      .update(inboundEvents)
      .set({ status: "duplicate", opportunityId, processedAt: now })
      .where(and(eq(inboundEvents.source, ev.source), eq(inboundEvents.status, "failed"), like(inboundEvents.externalRef, `${escapeLike(ref)}:%`), lt(inboundEvents.receivedAt, ev.receivedAt)));
  }
}

type Outcome = { ok: true; opportunityId: string | null; reply: Record<string, unknown> } | { ok: false; reason: string; unreadable: boolean };

async function run(ev: InboundRow, opts: { actorId: string | null; announceFailure: boolean }): Promise<Outcome> {
  let done: Handled;
  try {
    done = await handle(ev.source, ev.payload);
  } catch (e) {
    const reason = problemText(e);
    await db.update(inboundEvents).set({ status: "failed", error: reason, processedAt: new Date() }).where(eq(inboundEvents.id, ev.id));
    if (opts.announceFailure) notifyLater(() => tellOffice(failureNotice(ev, reason), null));
    return { ok: false, reason, unreadable: e instanceof ImportProblem && e.unreadable };
  }
  await markProcessed(ev, done.opportunityId);
  notifyLater(() => tellOffice(done.notice, opts.actorId));
  return { ok: true, opportunityId: done.opportunityId, reply: done.reply };
}

export type InboundReply = ({ ok: true } & Record<string, unknown>) | { ok: false; error: string; unreadable: boolean };

const reply = (o: Outcome): InboundReply => (o.ok ? { ok: true, ...o.reply } : { ok: false, error: o.reason, unreadable: o.unreadable });

/** A website form submission: stored first, then turned into a lead (or listed under "Couldn't import"). */
export async function receiveWebForm(payload: Payload): Promise<InboundReply> {
  const [ev] = await db.insert(inboundEvents).values({ source: "website_form", externalRef: null, payload }).returning();
  return reply(await run(ev, { actorId: null, announceFailure: true }));
}

/** A YouCanBook.me webhook body. The same event sent again (same booking, event and time) is ignored. */
export async function receiveBooking(body: string): Promise<InboundReply> {
  const parsed = parseLenientJsonObject(body);
  const key = parsed ? bookingKey(parsed) : null;
  if (key) {
    const dup = await db.query.inboundEvents.findFirst({
      where: and(eq(inboundEvents.source, "youcanbookme"), eq(inboundEvents.externalRef, key), eq(inboundEvents.status, "processed")),
    });
    if (dup) return { ok: true, duplicate: true, opportunityId: dup.opportunityId };
  }
  const [ev] = await db
    .insert(inboundEvents)
    .values({ source: "youcanbookme", externalRef: key, payload: parsed ?? { unparseable: body.slice(0, 20_000) } })
    .returning();
  return reply(await run(ev, { actorId: null, announceFailure: true }));
}

// ---------------------------------------------------------------------------
// "Couldn't import": list, Retry and Dismiss.
// ---------------------------------------------------------------------------

export interface NotImportedRow {
  id: string;
  sourceLabel: string;
  receivedAt: Date;
  reason: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  /** The visit time as the booking gave it. */
  visit: string | null;
  cancellation: boolean;
}

/** Why it's on the list, in words. Failures saved before imports were made forgiving hold raw validation errors. */
function reasonFor(ev: InboundRow, unreadable: boolean): string {
  if (ev.status === "received") return unreadable ? UNREADABLE : "It didn't finish importing (the server stopped part-way). Retry to import it.";
  if (!ev.error) return "It couldn't be imported.";
  try {
    const issues = JSON.parse(ev.error) as { path?: unknown[]; message?: unknown }[];
    if (Array.isArray(issues) && issues.length && issues.every((i) => typeof i?.message === "string")) {
      const what = issues.map((i) => [Array.isArray(i.path) ? i.path.join(".") : "", i.message].filter(Boolean).join(": ")).join("; ");
      return `A field was turned away (${clip(what, 200)}). Imports are more forgiving now, so Retry should bring it in.`;
    }
  } catch {
    // already a sentence
  }
  return ev.error;
}

function describe(ev: InboundRow): NotImportedRow {
  const text = unreadableText(ev.payload);
  const lead = peekLead(ev.payload);
  let cancellation = false;
  try {
    cancellation = ev.source === "youcanbookme" && bookingEvent(readPayload(ev.payload)).includes("cancel");
  } catch {
    // unreadable: not known to be a cancellation
  }
  return {
    id: ev.id,
    sourceLabel: SOURCE_LABEL[ev.source] ?? ev.source,
    receivedAt: ev.receivedAt,
    reason: reasonFor(ev, text !== null && !parseLenientJsonObject(text)),
    name: [fullName(lead.firstName, lead.lastName), lead.company].filter(Boolean).join(" · ") || null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    message: lead.description ? clip(lead.description, 600) : text ? clip(text, 600) : null,
    visit: lead.visitAt ? formatDateTime(parseBusinessDateTime(lead.visitAt)) || String(lead.visitAt) : null,
    cancellation,
  };
}

export async function listNotImported(now = new Date()): Promise<NotImportedRow[]> {
  const rows = await db.select().from(inboundEvents).where(needsAttention(now)).orderBy(desc(inboundEvents.receivedAt)).limit(LIST_LIMIT);
  return rows.map(describe);
}

export async function countNotImported(now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inboundEvents)
    .where(needsAttention(now));
  return Number(row?.n ?? 0);
}

/** A later event for the same YouCanBook.me booking that was imported (not dismissed). */
async function newerImport(ev: InboundRow) {
  const ref = bookingRefOf(ev);
  if (!ref) return null;
  const [newer] = await db
    .select({ id: inboundEvents.id, opportunityId: inboundEvents.opportunityId })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.source, ev.source),
        eq(inboundEvents.status, "processed"),
        isNull(inboundEvents.error),
        like(inboundEvents.externalRef, `${escapeLike(ref)}:%`),
        gt(inboundEvents.receivedAt, ev.receivedAt),
      ),
    )
    .limit(1);
  return newer ?? null;
}

export type RetryResult = { ok: true; opportunityId: string | null; message: string } | { ok: false; error: string };

/** Runs the stored submission through the same import again. On success it's linked to its lead. */
export async function retryImport(id: string, actor: { id: string }): Promise<RetryResult> {
  const now = new Date();
  const before = await db.query.inboundEvents.findFirst({ where: eq(inboundEvents.id, id) });
  if (!before) throw new Error("That submission wasn't found.");
  // Taking it first means two people pressing Retry can't import it twice.
  const [ev] = await db
    .update(inboundEvents)
    .set({ status: "received", processedAt: now })
    .where(and(eq(inboundEvents.id, id), needsAttention(now)))
    .returning();
  if (!ev) {
    if (before.status === "processed" || before.status === "duplicate") return { ok: true, opportunityId: before.opportunityId, message: "This one has already been dealt with." };
    throw new Error("It's being imported right now. Refresh the page in a moment.");
  }
  const was = { status: before.status, error: before.error };

  const newer = await newerImport(ev);
  if (newer) {
    await db.update(inboundEvents).set({ status: "duplicate", opportunityId: newer.opportunityId, processedAt: now }).where(eq(inboundEvents.id, id));
    await audit({ actorId: actor.id, action: "inbound.retry", entityType: "inbound_event", entityId: id, before: was, after: { status: "duplicate", opportunityId: newer.opportunityId } });
    return { ok: true, opportunityId: newer.opportunityId, message: "A later update for this booking was already imported, so this older one was set aside." };
  }

  const r = await run(ev, { actorId: actor.id, announceFailure: false });
  await audit({
    actorId: actor.id,
    action: "inbound.retry",
    entityType: "inbound_event",
    entityId: id,
    before: was,
    after: r.ok ? { status: "processed", opportunityId: r.opportunityId } : { status: "failed", error: r.reason },
  });
  return r.ok ? { ok: true, opportunityId: r.opportunityId, message: "Imported." } : { ok: false, error: r.reason };
}

/**
 * Takes a submission off the list without importing it. There is no "dismissed" status,
 * so it is kept as processed with no lead, and the reason says who dismissed it.
 */
export async function dismissImport(id: string, actor: { id: string; name: string }): Promise<void> {
  const now = new Date();
  const ev = await db.query.inboundEvents.findFirst({ where: eq(inboundEvents.id, id) });
  if (!ev) throw new Error("That submission wasn't found.");
  const reason = ev.status === "received" ? "It didn't finish importing." : (ev.error ?? "");
  const [done] = await db
    .update(inboundEvents)
    .set({ status: "processed", processedAt: now, error: `Dismissed by ${actor.name}. ${reason}`.trim() })
    .where(and(eq(inboundEvents.id, id), needsAttention(now)))
    .returning({ id: inboundEvents.id });
  // Already imported, dismissed or being retried by someone else: nothing to do.
  if (!done) return;
  await audit({ actorId: actor.id, action: "inbound.dismiss", entityType: "inbound_event", entityId: id, before: { status: ev.status, error: ev.error }, after: { status: "processed", dismissed: true } });
}

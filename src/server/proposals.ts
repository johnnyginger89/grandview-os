import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activities,
  contacts,
  customers,
  estimates,
  inboundEmails,
  messageTemplates,
  opportunities,
  outboundMessages,
  pipelineStages,
  properties,
  proposals,
  type ProposalAcceptMethod,
  type ProposalStatus,
} from "@/db/schema";
import { MESSAGE_TEMPLATES } from "@/db/seed-data";
import { endOfBusinessDay } from "@/lib/calendar-date";
import { sendEmail } from "@/lib/email";
import { calculateDoc, estimateDocSchema, type EstimateDoc } from "@/lib/estimating/document";
import { toDb } from "@/lib/money";
import { formatAddress, formatDate, renderTemplate } from "@/lib/utils";
import { audit } from "./audit";
import { assertCurrentVersion, EstimateLockedError, insertRevision, loadEstimate, lockEstimate, nextVersion, writeEstimateDoc } from "./estimates";
import { moveStage, stageByKey } from "./leads";
import { currentDocuments, visibleDocuments } from "./media";
import { notifyLater, notifyProposalEvent } from "./notifications";
import { createSoldProject } from "./project-status";
import { createWorkOrderForSale } from "./work-orders";
import { buildProposalView, normalizeView, type ProposalViewV2 } from "./proposal-view";
import { getCompany, getPricing, getProposalTemplate } from "./settings";

export { buildProposalView, normalizeView };
export type { ProposalView, ProposalViewV1, ProposalViewV2, ServiceLine } from "./proposal-view";

export class ProposalError extends Error {
  readonly expose = true;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ProposalRow = typeof proposals.$inferSelect;

/** Waiting on the customer: can still be signed, declined, withdrawn or replaced. */
const OPEN: ProposalStatus[] = ["sent", "viewed"];

export interface ProposalTotals {
  price: string;
  gst: string;
  total: string;
  deposit: string;
}

/** Apply a customer's option choices to the estimate document. */
function withSelection(doc: EstimateDoc, selected: Set<string>): EstimateDoc {
  return {
    ...doc,
    lines: doc.lines.map((l) => (l.isOptional ? { ...l, optionSelected: selected.has(l.id) } : l)),
    costItems: doc.costItems.map((c) => (c.isOptional ? { ...c, optionSelected: selected.has(c.id) } : c)),
  };
}

export function proposalTotals(doc: EstimateDoc, selectedIds: string[]): ProposalTotals {
  const t = calculateDoc(withSelection(doc, new Set(selectedIds))).totals;
  return { price: t.price.toFixed(2), gst: t.gst.toFixed(2), total: t.total.toFixed(2), deposit: t.deposit.toFixed(2) };
}

export function optionIds(doc: EstimateDoc): string[] {
  return [...doc.lines.filter((l) => l.isOptional).map((l) => l.id), ...doc.costItems.filter((c) => c.isOptional).map((c) => c.id)];
}

export function proposalUrl(token: string) {
  const base = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
  return `${base}/share/p/${token}`;
}

/**
 * When a proposal sent at `sentAt` stops accepting signatures: the end of the Vancouver day
 * "Estimates valid for (days)" later (Settings → Pricing, as set when it's sent).
 */
export async function proposalValidUntil(sentAt: Date): Promise<Date> {
  const { estimateValidDays } = await getPricing();
  return endOfBusinessDay(sentAt, Number(estimateValidDays));
}

/** Sent or viewed, and past the end of its last valid day: the customer can no longer accept it. */
export function proposalExpired(p: { status: string; expiresAt: Date | null }, now: Date): boolean {
  return (p.status === "sent" || p.status === "viewed") && !!p.expiresAt && p.expiresAt.getTime() < now.getTime();
}

export const sendProposalSchema = z.object({
  to: z.string().trim().toLowerCase().email("Enter the customer's email").optional().or(z.literal("").transform(() => undefined)),
  /** Shown at the top of the proposal page. */
  message: z.string().trim().max(2000).optional(),
  email: z.boolean().default(true),
  /** The email as the sender edited it; [Proposal link] is replaced with the real link. */
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().max(10_000).optional(),
  /** The estimate's version on the sender's screen: what they see is what gets sent. */
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullish(),
});

/** Stands in for the link in the email editor; the link itself only exists once the proposal is created. */
export const PROPOSAL_LINK_TOKEN = "[Proposal link]";

async function proposalTemplate(): Promise<{ subject: string; body: string }> {
  const t = await db.query.messageTemplates.findFirst({ where: eq(messageTemplates.key, "proposal") });
  const fallback = MESSAGE_TEMPLATES.find((x) => x.key === "proposal")!;
  return { subject: t?.subject || fallback.subject, body: t?.body || fallback.body };
}

/**
 * The proposal email from the "Sending a proposal" template (Settings → Email templates),
 * with this customer's details filled in and the link left as [Proposal link].
 */
export async function proposalEmailDraft(estimateId: string, sender: { name: string }, now = new Date()): Promise<{ to: string; subject: string; body: string } | null> {
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
  if (!estimate) return null;
  const [customer, contact, company, template, validUntil] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) }),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, estimate.customerId), eq(contacts.isPrimary, true)) }),
    getCompany(),
    proposalTemplate(),
    // The date it gets if it's sent today, not whatever an earlier send gave it.
    proposalValidUntil(now),
  ]);
  const vars = {
    first_name: contact?.firstName?.trim() || customer?.displayName.split(" ")[0] || "there",
    customer_name: customer?.displayName ?? "",
    job_title: estimate.title,
    proposal_link: PROPOSAL_LINK_TOKEN,
    valid_until: `This proposal is valid until ${formatDate(validUntil, { dateStyle: "long" })}.`,
    sender_name: sender.name,
    company_name: company.displayName || company.name,
    company_phone: company.phone ?? "",
  };
  const tidy = (t: string) => t.replace(/\n{3,}/g, "\n\n").trim();
  return { to: contact?.email ?? customer?.email ?? "", subject: renderTemplate(template.subject, vars).trim(), body: tidy(renderTemplate(template.body, vars)) };
}

/** Puts the real link where the sender left [Proposal link]; adds it at the end if they removed it. */
export function withProposalLink(body: string, link: string): string {
  const filled = body.split(PROPOSAL_LINK_TOKEN).join(link).split("{{proposal_link}}").join(link);
  return filled.includes(link) ? filled : `${filled.trimEnd()}\n\nView and accept your proposal: ${link}`;
}

type LoadedEstimate = NonNullable<Awaited<ReturnType<typeof loadEstimate>>>;
type EstimateRow = LoadedEstimate["estimate"];

/** Everything the customer-facing view shows besides the estimate document (read outside any transaction). */
async function viewContext(estimate: EstimateRow) {
  const [customer, contact, property, company, template] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) }),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, estimate.customerId), eq(contacts.isPrimary, true)) }),
    estimate.propertyId ? db.query.properties.findFirst({ where: eq(properties.id, estimate.propertyId) }) : null,
    getCompany(),
    getProposalTemplate(),
  ]);
  if (!customer) throw new ProposalError("Customer not found");
  return { customer, contact, property, company, template };
}
type ViewContext = Awaited<ReturnType<typeof viewContext>>;

/** The customer-facing view of an estimate document (used when sending and for the staff draft preview). */
function viewFrom(ctx: ViewContext, estimate: EstimateRow, doc: EstimateDoc, opts: { revision: number; message: string | null; validUntil: Date; issuedAt: Date }) {
  const { customer, contact, property, company, template } = ctx;
  return buildProposalView({
    doc,
    number: estimate.number ?? 0,
    revision: opts.revision,
    customer: {
      name: customer.displayName,
      firstName: contact?.firstName?.trim() || null,
      contactName: contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null : null,
      phone: contact?.phone || customer.phone || null,
    },
    jobAddress: property ? formatAddress(property) : null,
    validUntil: opts.validUntil,
    issuedAt: opts.issuedAt,
    company,
    template,
    message: opts.message,
  });
}

/** What the customer would see if the estimate were sent now, and the upgrades they'd find ticked. */
async function draftFor({ estimate, doc }: LoadedEstimate, now: Date) {
  const view = viewFrom(await viewContext(estimate), estimate, doc, { revision: (estimate.revision ?? 0) + 1, message: null, validUntil: await proposalValidUntil(now), issuedAt: now });
  const recommended = view.options.filter((o) => o.recommended).map((o) => o.id);
  return { view, initialSelection: recommended, totals: proposalTotals(doc, recommended) };
}

/** Staff "Preview proposal": what the customer would see if the estimate were sent now. Nothing is saved. */
export async function draftProposal(estimateId: string, now = new Date()) {
  const loaded = await loadEstimate(estimateId);
  if (!loaded) return null;
  return { status: "sent", ...(await draftFor(loaded, now)), accepted: null };
}

export async function draftTotals(estimateId: string, selectedIds: string[]): Promise<ProposalTotals | null> {
  const loaded = await loadEstimate(estimateId);
  if (!loaded) return null;
  const allowed = new Set(optionIds(loaded.doc));
  return proposalTotals(loaded.doc, selectedIds.filter((id) => allowed.has(id)));
}

export interface AcceptancePreview {
  options: { id: string; title: string; area: string | null; price: string }[];
  /** Ticked the same way the customer's page would have them. */
  initialSelection: string[];
  totals: ProposalTotals;
}

/**
 * "Mark as accepted": the upgrades and totals the customer would see if the estimate were sent
 * now, from the saved copy that gets accepted. `expectedUpdatedAt` is the version on screen.
 */
export async function acceptancePreview(estimateId: string, expectedUpdatedAt: string | null, now = new Date()): Promise<AcceptancePreview> {
  const loaded = await loadEstimate(estimateId);
  if (!loaded) throw new ProposalError("Estimate not found");
  if (loaded.estimate.status === "accepted") throw new EstimateLockedError();
  assertCurrentVersion(loaded.estimate, expectedUpdatedAt);
  const { view, initialSelection, totals } = await draftFor(loaded, now);
  return { options: view.options.map(({ id, title, area, price }) => ({ id, title, area, price })), initialSelection, totals };
}

interface FreezeOptions {
  message: string | null;
  to: string | null;
  reason: string;
  activity: string | null;
  /** The version on the sender's screen; null when the caller doesn't track one. */
  expectedUpdatedAt: string | null;
  /** When it's sent, and the end of its last valid day (Settings → Pricing, read before the transaction). */
  now: Date;
  validUntil: Date;
}

/**
 * Freezes the estimate as it is now into a new open proposal (replacing any open one), in the
 * caller's transaction. The estimate lock is taken first, so no save or other send can land in
 * between: the proposal is exactly the saved copy at the expected version. Each proposal is
 * valid from the day it's sent; the estimate gets the same date so every screen agrees.
 */
async function freezeInTx(tx: Tx, estimateId: string, ctx: ViewContext, opts: FreezeOptions, user: { id: string; name: string }) {
  const current = await lockEstimate(tx, estimateId);
  if (!current) throw new ProposalError("Estimate not found");
  if (current.status === "accepted") throw new EstimateLockedError();
  assertCurrentVersion(current, opts.expectedUpdatedAt);
  const { estimate, doc } = (await loadEstimate(estimateId, tx))!;
  if (!doc.lines.length && !doc.costItems.length) throw new ProposalError("Add at least one item before sending a proposal.");
  const revision = await insertRevision(tx, estimateId, doc, opts.reason, user.id);
  const view = viewFrom(ctx, estimate, doc, { revision, message: opts.message, validUntil: opts.validUntil, issuedAt: opts.now });
  const token = randomBytes(24).toString("base64url");
  const now = nextVersion(current, opts.now);
  await tx
    .update(proposals)
    .set({ status: "superseded" })
    .where(and(eq(proposals.estimateId, estimateId), inArray(proposals.status, OPEN)));
  // Sent at the estimate's new version, so "changed since it was sent" is updatedAt > sentAt.
  const [proposal] = await tx
    .insert(proposals)
    .values({ estimateId, revision, token, snapshot: doc, view, message: opts.message, sentTo: opts.to, sentBy: user.id, sentAt: now, expiresAt: opts.validUntil })
    .returning();
  await tx.update(estimates).set({ status: "sent", sentAt: now, validUntil: opts.validUntil, updatedAt: now }).where(eq(estimates.id, estimateId));
  if (opts.activity) {
    await tx.insert(activities).values({ customerId: estimate.customerId, opportunityId: estimate.opportunityId, type: "estimate", body: opts.activity.replace("{revision}", String(revision)), createdBy: user.id });
  }
  await audit({ actorId: user.id, action: "proposal.send", entityType: "proposal", entityId: proposal.id, after: { estimateId, revision, to: opts.to, expiresAt: opts.validUntil.toISOString() } }, tx);
  return { proposal, token, estimate, updatedAt: now.toISOString() };
}

/** Freeze the estimate as a proposal, optionally email the link. Returns the link either way. */
export async function sendProposal(estimateId: string, raw: z.input<typeof sendProposalSchema>, user: { id: string; name: string }, now = new Date()) {
  const input = sendProposalSchema.parse(raw);
  if (input.email && !input.to) throw new ProposalError("Enter the customer's email, or untick 'Email it'.");
  const current = await db.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
  if (!current) throw new ProposalError("Estimate not found");
  const [ctx, validUntil] = await Promise.all([viewContext(current), proposalValidUntil(now)]);

  const { proposal, token, estimate, updatedAt } = await db.transaction((tx) =>
    freezeInTx(
      tx,
      estimateId,
      ctx,
      {
        message: input.message || null,
        to: input.to ?? null,
        reason: "Proposal sent",
        activity: `Proposal for estimate #${current.number} (revision {revision}) ${input.email ? `sent to ${input.to}` : "created – link shared manually"}`,
        expectedUpdatedAt: input.expectedUpdatedAt ?? null,
        now,
        validUntil,
      },
      user,
    ),
  );

  // Move the lead forward if it's still before "Proposal Sent".
  if (estimate.opportunityId) {
    const opp = await db
      .select({ key: pipelineStages.key })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(eq(opportunities.id, estimate.opportunityId));
    if (opp[0] && ["new_lead", "contacted", "estimate_booked", "estimate_completed"].includes(opp[0].key)) {
      await moveStage(estimate.opportunityId, (await stageByKey("proposal_sent")).id, user.id);
    }
  }

  const link = proposalUrl(token);
  let emailStatus: "sent" | "logged" | "failed" | "skipped" = "skipped";
  let emailError: string | undefined;
  if (input.email && input.to) {
    // What the sender saw and edited; older callers get the template as it stands.
    const draft = input.body && input.subject ? null : await proposalEmailDraft(estimateId, user, now);
    const subject = input.subject || draft?.subject || `Your painting proposal from ${(await getCompany()).name}`;
    const text = withProposalLink(input.body || draft?.body || "", link);
    const company = await getCompany();
    const r = await sendEmail({ to: input.to, subject, text, replyTo: company.email || undefined });
    emailStatus = r.status;
    emailError = r.error;
    await db.insert(outboundMessages).values({
      channel: "email",
      toAddress: input.to,
      subject,
      body: text,
      status: r.status,
      provider: r.provider,
      providerMessageId: r.providerMessageId,
      error: r.error,
      customerId: estimate.customerId,
      opportunityId: estimate.opportunityId,
      estimateId,
      threadId: r.threadId ?? null,
      templateKey: "proposal",
      sentBy: user.id,
      sentAt: r.status === "failed" ? null : new Date(),
    });
  }
  return { proposalId: proposal.id, link, emailStatus, emailError, updatedAt };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** Public lookup by link token. Loading it doesn't count as a view (see recordProposalView). */
export async function getProposalForCustomer(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token) });
  if (!p) return null;
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, p.estimateId), columns: { jobType: true } });
  const expired = proposalExpired(p, new Date());
  const doc = p.snapshot as EstimateDoc;
  // Old proposals stored a v1 view; it is converted for display only (the stored view and its hash never change).
  const view: ProposalViewV2 = normalizeView(p.view, estimate?.jobType ?? "default");
  const allowed = new Set(optionIds(doc));
  const recommended = view.options.filter((o) => o.recommended && allowed.has(o.id)).map((o) => o.id);
  return {
    id: p.id,
    status: expired ? ("expired" as const) : p.status,
    view,
    initialSelection: p.status === "accepted" ? (p.selectedOptionIds ?? []) : recommended,
    totals: p.status === "accepted" && p.acceptedTotals ? (p.acceptedTotals as unknown as ProposalTotals) : proposalTotals(doc, recommended),
    accepted:
      p.status === "accepted"
        ? { name: p.acceptedName ?? "", at: p.acceptedAt?.toISOString() ?? "", signature: p.signature ?? "", hash: p.documentHash ?? "", message: p.acceptedMessage ?? null }
        : null,
  };
}

export type CustomerProposal = NonNullable<Awaited<ReturnType<typeof getProposalForCustomer>>>;

const REOPEN_AFTER_MS = 12 * 3_600_000;

/**
 * Counts a customer opening their proposal. The page reports it from the browser once someone
 * is actually looking, so link previews (iMessage, WhatsApp) and email link scanners that only
 * fetch the page never count. The office is told on the first open, and again when the customer
 * comes back after a while.
 */
export async function recordProposalView(token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return;
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token), columns: { id: true, estimateId: true, status: true, lastViewedAt: true } });
  if (!p || (p.status !== "sent" && p.status !== "viewed")) return;
  const now = new Date();
  const open = and(eq(proposals.id, p.id), inArray(proposals.status, ["sent", "viewed"]));
  // Two tabs opening at once must not both count as the first view.
  const [first] = await db.update(proposals).set({ firstViewedAt: now }).where(and(open, isNull(proposals.firstViewedAt))).returning({ id: proposals.id });
  await db
    .update(proposals)
    .set({ status: "viewed", lastViewedAt: now, viewCount: sql`${proposals.viewCount} + 1` })
    .where(open);
  if (first) {
    const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, p.estimateId), columns: { customerId: true, opportunityId: true, number: true } });
    if (estimate) {
      await db.insert(activities).values({
        customerId: estimate.customerId,
        opportunityId: estimate.opportunityId,
        type: "estimate",
        body: `Customer opened the proposal for estimate #${estimate.number}`,
      });
    }
    notifyLater(() => notifyProposalEvent("viewed", p.id));
  } else if (p.lastViewedAt && now.getTime() - p.lastViewedAt.getTime() > REOPEN_AFTER_MS) {
    notifyLater(() => notifyProposalEvent("viewed", p.id, { reopened: true }));
  }
}

/** Insurance documents may be opened from any proposal link except a withdrawn one. Not counted as a view. */
export async function proposalAllowsDocuments(token: string): Promise<boolean> {
  if (!TOKEN_RE.test(token)) return false;
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token), columns: { status: true } });
  return !!p && p.status !== "withdrawn";
}

export async function previewTotals(token: string, selectedIds: string[]): Promise<ProposalTotals | null> {
  if (!TOKEN_RE.test(token)) return null;
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token), columns: { snapshot: true } });
  if (!p) return null;
  const doc = p.snapshot as EstimateDoc;
  const allowed = new Set(optionIds(doc));
  return proposalTotals(doc, selectedIds.filter((id) => allowed.has(id)));
}

export const acceptSchema = z.object({
  name: z.string().trim().min(2, "Type your full name").max(120),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("").transform(() => undefined)),
  signature: z
    .string()
    .startsWith("data:image/png;base64,", "Please sign in the box")
    .max(400_000, "Signature image is too large")
    .refine((s) => s.length > 200, "Please sign in the box"),
  agree: z.literal(true, { error: "Please confirm you agree to the proposal" }),
  selectedOptionIds: z.array(z.string().uuid()).max(200),
  message: z.string().trim().max(1000, "Please keep your message under 1,000 characters").optional(),
});

/** The signed-in staff member whose screen the customer signed on ("Sign now on this device"). */
export interface StaffDevice {
  id: string;
  name: string;
}

/**
 * Customer signs. Claims the proposal atomically, locks the estimate to exactly
 * what was signed, creates the project and marks the lead won.
 */
export async function acceptProposal(token: string, raw: unknown, meta: { ip: string | null; userAgent: string | null; staffDevice?: StaffDevice | null }) {
  const input = acceptSchema.parse(raw);
  if (!TOKEN_RE.test(token)) throw new ProposalError("This proposal link is not valid.");
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token) });
  if (!p) throw new ProposalError("This proposal link is not valid.");
  if (p.status === "accepted") throw new ProposalError("This proposal has already been accepted. Thank you!");
  if (p.status !== "sent" && p.status !== "viewed") throw new ProposalError("This proposal is no longer open. Please contact us for an updated one.");
  if (proposalExpired(p, new Date())) throw new ProposalError("This proposal has expired. Please contact us and we'll send an updated one.");
  const a: Acceptance = {
    name: input.name,
    email: input.email ?? null,
    signature: input.signature,
    message: input.message || null,
    selected: input.selectedOptionIds,
    method: "online",
    ip: meta.ip,
    userAgent: meta.userAgent,
    markedBy: null,
    device: meta.staffDevice ?? null,
  };
  const ctx = await acceptanceContext(p.estimateId);
  if (!ctx) throw new ProposalError("This proposal is no longer available.");
  const done = await db.transaction((tx) => acceptInTx(tx, p, a, ctx));
  return afterAcceptance(p.id, ctx.estimate, a, done);
}

export const ACCEPT_METHOD_LABEL: Record<Exclude<ProposalAcceptMethod, "online">, string> = {
  phone: "By phone",
  email: "By email",
  in_person: "In person",
  paper: "Signed a paper copy",
};
const METHOD_PHRASE: Record<ProposalAcceptMethod, string> = { online: "online", phone: "by phone", email: "by email", in_person: "in person", paper: "on a signed paper copy" };

export const acceptForCustomerSchema = z.object({
  name: z.string().trim().min(2, "Type the name of the person who accepted").max(120),
  method: z.enum(["phone", "email", "in_person", "paper"], { error: "Choose how they accepted" }),
  selectedOptionIds: z.array(z.string().uuid()).max(200).default([]),
  note: z.string().trim().max(1000, "Please keep the note under 1,000 characters").optional(),
  /** The estimate's version on the office's screen: what they checked is what gets accepted. */
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullish(),
});

/**
 * The office marks an estimate accepted for the customer (they said yes by phone,
 * email, in person or on paper). The estimate is frozen as it is now, exactly as if
 * it had been sent and signed: the estimate locks, the job is created and the lead is won.
 */
export async function acceptProposalForCustomer(estimateId: string, raw: unknown, user: { id: string; name: string }, now = new Date()) {
  const input = acceptForCustomerSchema.parse(raw);
  const ctx = await acceptanceContext(estimateId);
  if (!ctx) throw new ProposalError("Estimate not found");
  const [view, validUntil] = await Promise.all([viewContext(ctx.estimate), proposalValidUntil(now)]);
  const a: Acceptance = {
    name: input.name,
    email: null,
    signature: null,
    message: input.note || null,
    selected: input.selectedOptionIds,
    method: input.method,
    ip: null,
    userAgent: null,
    markedBy: user,
    device: null,
  };
  // Frozen and accepted in one transaction: the job is sold exactly as on screen, or nothing changes.
  const { proposalId, done } = await db.transaction(async (tx) => {
    // Always the estimate as it is on screen now, even if an older version was sent.
    const { proposal } = await freezeInTx(
      tx,
      estimateId,
      view,
      { message: null, to: null, reason: "Accepted by the customer", activity: null, expectedUpdatedAt: input.expectedUpdatedAt ?? null, now, validUntil },
      user,
    );
    return { proposalId: proposal.id, done: await acceptInTx(tx, proposal, a, ctx) };
  });
  return afterAcceptance(proposalId, ctx.estimate, a, done);
}

interface Acceptance {
  name: string;
  email: string | null;
  /** Drawn signature (online only). */
  signature: string | null;
  message: string | null;
  selected: string[];
  method: ProposalAcceptMethod;
  ip: string | null;
  userAgent: string | null;
  /** The staff member who marked it accepted; null when the customer signed online. */
  markedBy: { id: string; name: string } | null;
  /** Signed in person on this staff member's screen. */
  device: StaffDevice | null;
}

/** Read before the acceptance transaction: the estimate's fixed details, the customer's name and the insurance documents on show. */
async function acceptanceContext(estimateId: string) {
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
  if (!estimate) return null;
  const [customer, documents] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId), columns: { displayName: true } }),
    currentDocuments(new Date()),
  ]);
  // What the customer was shown, so we can later prove which certificate was current at signing.
  return { estimate, customerName: customer?.displayName ?? null, documentIds: visibleDocuments(documents).map((x) => x.id) };
}
type AcceptanceContext = NonNullable<Awaited<ReturnType<typeof acceptanceContext>>>;

/**
 * Claims the proposal, and only then writes exactly what was accepted into the estimate, locks
 * it and sells the job, all in the caller's transaction. When the claim is lost (another
 * signature, a decline, a withdrawal or a newer proposal got there first) it throws before
 * anything is written, so the estimate is left as it was.
 */
async function acceptInTx(tx: Tx, p: ProposalRow, a: Acceptance, ctx: AcceptanceContext) {
  // The estimate's row lock comes first, in the same order as saves, sends and declines, so
  // racing requests queue instead of deadlocking. It's a lock, not a write.
  const current = await lockEstimate(tx, p.estimateId);
  if (!current) throw new ProposalError("This proposal is no longer available.");
  const acceptedAt = nextVersion(current);
  const doc = p.snapshot as EstimateDoc;
  const allowed = new Set(optionIds(doc));
  const selected = a.selected.filter((id) => allowed.has(id));
  const signedDoc = estimateDocSchema.parse(withSelection(doc, new Set(selected)));
  const result = calculateDoc(signedDoc);
  const t = result.totals;
  const totals = { price: t.price.toFixed(2), gst: t.gst.toFixed(2), total: t.total.toFixed(2), deposit: t.deposit.toFixed(2) };
  const documentHash = createHash("sha256")
    .update(JSON.stringify({ view: p.view, selected, totals, name: a.name, acceptedAt: acceptedAt.toISOString(), method: a.method, markedBy: a.markedBy?.id ?? null }))
    .digest("hex");

  const claimed = await tx
    .update(proposals)
    .set({
      status: "accepted",
      acceptedAt,
      acceptedName: a.name,
      acceptedEmail: a.email,
      signature: a.signature,
      acceptedIp: a.ip,
      acceptedUserAgent: a.userAgent?.slice(0, 500) ?? null,
      selectedOptionIds: selected,
      acceptedTotals: totals,
      documentHash,
      // An office note is internal; only a customer's own message shows on their proposal.
      acceptedMessage: a.markedBy ? null : a.message,
      acceptedDocumentIds: ctx.documentIds,
      acceptedBy: a.markedBy?.id ?? null,
      acceptedMethod: a.method,
    })
    .where(and(eq(proposals.id, p.id), inArray(proposals.status, OPEN)))
    .returning({ id: proposals.id });
  if (!claimed.length) throw new ProposalError("This proposal has already been accepted or replaced.");
  if (current.status === "accepted") throw new EstimateLockedError();

  // If the estimate was edited after sending, the customer still gets exactly what they saw,
  // including the upgrades they chose; the same update locks it.
  await writeEstimateDoc(tx, current.id, signedDoc, { result, now: acceptedAt, set: { status: "accepted", acceptedAt } });
  await tx
    .update(proposals)
    .set({ status: "superseded" })
    .where(and(eq(proposals.estimateId, p.estimateId), inArray(proposals.status, OPEN)));

  const { estimate } = ctx;
  const inPerson = a.device ? ` in person, on ${a.device.name}'s device` : "";
  const how = a.markedBy ? `accepted ${METHOD_PHRASE[a.method]} by ${a.name} (marked by ${a.markedBy.name})` : `accepted and signed by ${a.name}${inPerson}`;
  const project = await createSoldProject(
    {
      name: `${ctx.customerName ?? "Customer"} – ${doc.title}`,
      customerId: estimate.customerId,
      propertyId: estimate.propertyId,
      estimateId: estimate.id,
      proposalId: p.id,
      opportunityId: estimate.opportunityId,
      contractPrice: totals.price,
      contractTotal: totals.total,
      depositRequired: totals.deposit,
      estimatedHours: toDb(t.hours, 4),
      estimatedCost: toDb(t.totalCost),
    },
    { soldAt: acceptedAt, actorId: a.markedBy?.id ?? null, note: a.markedBy ? `Accepted ${METHOD_PHRASE[a.method]} (marked by ${a.markedBy.name})` : `Proposal signed${inPerson}` },
    tx,
  );
  await tx.insert(activities).values({
    customerId: estimate.customerId,
    opportunityId: estimate.opportunityId,
    type: "estimate",
    body: `Proposal for estimate #${estimate.number} ${how}${selected.length ? ` with ${selected.length} optional upgrade(s)` : ""}. Total ${totals.total} incl. GST.${a.markedBy && a.message ? ` Note: ${a.message}` : ""}`,
    meta: { proposalId: p.id, documentHash, method: a.method, ...(a.device ? { signedOnDeviceOf: a.device.id } : {}) },
    createdBy: a.markedBy?.id ?? null,
  });
  await audit(
    {
      actorId: a.markedBy?.id ?? null,
      action: a.markedBy ? "proposal.accept_for_customer" : "proposal.accept",
      entityType: "proposal",
      entityId: p.id,
      after: {
        name: a.name,
        method: a.method,
        selected,
        totals,
        ip: a.ip,
        documentHash,
        ...(a.markedBy && a.message ? { note: a.message } : {}),
        // "Sign now on this device": the customer signed in person, on this staff member's screen.
        ...(a.device ? { signedInPerson: true, staffDevice: { userId: a.device.id, name: a.device.name } } : {}),
      },
    },
    tx,
  );
  return { project, totals };
}

/** Once the sale is committed: the lead is won, the crew's work order started and the office told. */
async function afterAcceptance(proposalId: string, estimate: EstimateRow, a: Acceptance, done: Awaited<ReturnType<typeof acceptInTx>>) {
  const actorId = a.markedBy?.id ?? null;
  if (estimate.opportunityId) {
    const won = await stageByKey("won");
    await moveStage(estimate.opportunityId, won.id, actorId).catch((e) => console.error("[proposal] could not mark lead won", e));
  }
  // The crew's work order is started at the same time, from the signed estimate.
  if (done.project) await createWorkOrderForSale(done.project.id, actorId);
  // Whoever handed over their screen was there when it was signed, so isn't notified.
  notifyLater(() => notifyProposalEvent("accepted", proposalId, { actorId: actorId ?? a.device?.id ?? null }));
  return { projectId: done.project?.id ?? null, totals: done.totals };
}

export async function declineProposal(token: string, reason: string | undefined) {
  if (!TOKEN_RE.test(token)) throw new ProposalError("This proposal link is not valid.");
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token), columns: { id: true, estimateId: true, status: true } });
  if (!p || !OPEN.includes(p.status)) throw new ProposalError("This proposal is no longer open.");
  const clean = reason?.trim().slice(0, 1000) || null;
  await db.transaction(async (tx) => {
    // Same order as acceptance: a decline racing a signature waits for it, then finds the proposal closed.
    const estimate = await lockEstimate(tx, p.estimateId);
    const now = estimate ? nextVersion(estimate) : new Date();
    const claimed = await tx
      .update(proposals)
      .set({ status: "declined", declinedAt: now, declineReason: clean })
      .where(and(eq(proposals.id, p.id), inArray(proposals.status, OPEN)))
      .returning({ id: proposals.id });
    if (!claimed.length) throw new ProposalError("This proposal is no longer open.");
    if (!estimate) return;
    // A sold estimate stays sold and locked, whatever an old link says.
    await tx
      .update(estimates)
      .set({ status: "declined", updatedAt: now })
      .where(and(eq(estimates.id, estimate.id), ne(estimates.status, "accepted")));
    await tx.insert(activities).values({
      customerId: estimate.customerId,
      opportunityId: estimate.opportunityId,
      type: "estimate",
      body: `Customer declined the proposal for estimate #${estimate.number}${clean ? `: "${clean}"` : ""}`,
    });
  });
  notifyLater(() => notifyProposalEvent("declined", p.id));
}

export async function listProposals(estimateId: string) {
  return db.query.proposals.findMany({
    where: eq(proposals.estimateId, estimateId),
    orderBy: desc(proposals.sentAt),
    columns: { id: true, revision: true, status: true, token: true, sentTo: true, sentAt: true, firstViewedAt: true, viewCount: true, acceptedAt: true, acceptedName: true, acceptedMethod: true, declinedAt: true, declineReason: true, expiresAt: true },
  });
}

/** The office takes back an open proposal so its link stops accepting signatures. The estimate itself is never changed. */
export async function withdrawProposal(proposalId: string, userId: string) {
  await db.transaction(async (tx) => {
    const [res] = await tx
      .update(proposals)
      .set({ status: "withdrawn" })
      .where(and(eq(proposals.id, proposalId), inArray(proposals.status, OPEN)))
      .returning({ id: proposals.id, estimateId: proposals.estimateId });
    if (!res) throw new ProposalError("Only open proposals can be withdrawn.");
    await audit({ actorId: userId, action: "proposal.withdraw", entityType: "proposal", entityId: proposalId, after: { estimateId: res.estimateId } }, tx);
  });
}

// ---------------------------------------------------------------------------
// Following up
// ---------------------------------------------------------------------------

/** Days after the proposal (or the last follow-up) before it shows as "time to follow up". */
export const FOLLOW_UP_AFTER_DAYS = 3;

export const followUpSchema = z.object({
  to: z.string().trim().toLowerCase().email("Enter the customer's email"),
  subject: z.string().trim().min(1, "Add a subject").max(200),
  body: z.string().trim().min(1, "Write the email").max(10_000),
});

async function openProposal(proposalId: string, now: Date) {
  const [p] = await db
    .select({ id: proposals.id, token: proposals.token, status: proposals.status, sentTo: proposals.sentTo, estimateId: proposals.estimateId, expiresAt: proposals.expiresAt })
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!p) throw new ProposalError("Proposal not found");
  if (p.status !== "sent" && p.status !== "viewed") throw new ProposalError("This proposal isn't waiting on the customer any more, so there's nothing to follow up.");
  // Chasing it would send the customer a link they can't accept. A follow-up never extends it.
  if (proposalExpired(p, now)) {
    throw new ProposalError(`This proposal expired on ${formatDate(p.expiresAt)}, so the customer can no longer accept it. Send an updated proposal from the estimate instead.`);
  }
  return p;
}

/** The last proposal email or follow-up for this estimate, so the follow-up lands in the same conversation. */
async function lastProposalEmail(estimateId: string) {
  const [m] = await db
    .select({ subject: outboundMessages.subject, threadId: outboundMessages.threadId })
    .from(outboundMessages)
    .where(and(eq(outboundMessages.estimateId, estimateId), inArray(outboundMessages.templateKey, ["proposal", "proposal_follow_up"]), inArray(outboundMessages.status, ["sent", "logged"])))
    .orderBy(desc(outboundMessages.createdAt))
    .limit(1);
  return m ?? null;
}

const reply = (subject: string) => (/^re:/i.test(subject) ? subject : `Re: ${subject}`);

/** The follow-up email, ready to send: "Following up on a proposal" template, this customer's details and the proposal link. */
export async function followUpDraft(proposalId: string, sender: { name: string }, now = new Date()): Promise<{ to: string; subject: string; body: string }> {
  const p = await openProposal(proposalId, now);
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, p.estimateId) });
  if (!estimate) throw new ProposalError("Estimate not found");
  const [customer, contact, company, t, last] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) }),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, estimate.customerId), eq(contacts.isPrimary, true)) }),
    getCompany(),
    db.query.messageTemplates.findFirst({ where: eq(messageTemplates.key, "proposal_follow_up") }),
    lastProposalEmail(p.estimateId),
  ]);
  const fallback = MESSAGE_TEMPLATES.find((x) => x.key === "proposal_follow_up")!;
  const vars = {
    first_name: contact?.firstName?.trim() || customer?.displayName.split(" ")[0] || "there",
    customer_name: customer?.displayName ?? "",
    job_title: estimate.title,
    proposal_link: proposalUrl(p.token),
    sender_name: sender.name,
    company_name: company.displayName || company.name,
    company_phone: company.phone ?? "",
  };
  const body = renderTemplate(t?.body || fallback.body, vars).replace(/\n{3,}/g, "\n\n").trim();
  // Same subject as the proposal email, so it reads as one conversation in the customer's inbox too.
  const subject = last?.subject ? reply(last.subject) : renderTemplate(t?.subject || fallback.subject, vars).trim();
  return { to: p.sentTo ?? contact?.email ?? customer?.email ?? "", subject, body };
}

/** Sends the follow-up the user checked, as a reply in the proposal's email conversation. */
export async function sendProposalFollowUp(proposalId: string, raw: z.input<typeof followUpSchema>, user: { id: string; name: string }, now = new Date()) {
  const input = followUpSchema.parse(raw);
  const p = await openProposal(proposalId, now);
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, p.estimateId), columns: { id: true, number: true, customerId: true, opportunityId: true } });
  if (!estimate) throw new ProposalError("Estimate not found");
  const link = proposalUrl(p.token);
  const text = input.body.includes(link) ? input.body : `${input.body.trimEnd()}\n\nYour proposal: ${link}`;
  const [company, last] = await Promise.all([getCompany(), lastProposalEmail(p.estimateId)]);
  const r = await sendEmail({ to: input.to, subject: input.subject, text, replyTo: company.email || undefined, threadId: last?.threadId ?? undefined });
  await db.insert(outboundMessages).values({
    channel: "email",
    toAddress: input.to,
    subject: input.subject,
    body: text,
    status: r.status,
    provider: r.provider,
    providerMessageId: r.providerMessageId,
    error: r.error,
    customerId: estimate.customerId,
    opportunityId: estimate.opportunityId,
    estimateId: estimate.id,
    threadId: r.threadId ?? last?.threadId ?? null,
    templateKey: "proposal_follow_up",
    sentBy: user.id,
    sentAt: r.status === "failed" ? null : new Date(),
  });
  if (r.status !== "failed") {
    await db.insert(activities).values({
      customerId: estimate.customerId,
      opportunityId: estimate.opportunityId,
      type: "email",
      body: `Followed up on the proposal for estimate #${estimate.number} (emailed ${input.to})`,
      createdBy: user.id,
    });
    await audit({ actorId: user.id, action: "proposal.follow_up", entityType: "proposal", entityId: p.id, after: { to: input.to } });
  }
  return { status: r.status, error: r.error };
}

export interface FollowUpDue {
  proposalId: string;
  estimateId: string;
  number: number | null;
  title: string;
  customerName: string;
  sentAt: string;
  /** The proposal email or the last follow-up, whichever was later. */
  lastContactAt: string;
  followUps: number;
  viewCount: number;
  /** When the customer last emailed us (Gmail), if after the last contact. */
  customerEmailedAt: string | null;
}

/** Open proposals nobody has chased for a few days: the newest first-in-line, oldest contact first. Expired ones are left out (their link is dead). */
export async function followUpsDue(now: Date, limit = 10): Promise<FollowUpDue[]> {
  const cutoff = new Date(now.getTime() - FOLLOW_UP_AFTER_DAYS * 86_400_000);
  const followUps = db
    .select({
      estimateId: outboundMessages.estimateId,
      n: sql<number>`count(*)::int`.as("n"),
      last: sql<Date>`max(${outboundMessages.createdAt})`.as("last"),
    })
    .from(outboundMessages)
    .where(and(eq(outboundMessages.templateKey, "proposal_follow_up"), isNotNull(outboundMessages.estimateId), inArray(outboundMessages.status, ["sent", "logged"])))
    .groupBy(outboundMessages.estimateId)
    .as("f");
  const lastContact = sql<Date>`greatest(${proposals.sentAt}, coalesce(${followUps.last}, ${proposals.sentAt}))`;
  const rows = await db
    .select({
      proposalId: proposals.id,
      estimateId: proposals.estimateId,
      number: estimates.number,
      title: estimates.title,
      customerId: estimates.customerId,
      customerName: customers.displayName,
      sentAt: proposals.sentAt,
      lastContactAt: lastContact,
      followUps: sql<number>`coalesce(${followUps.n}, 0)`,
      viewCount: proposals.viewCount,
    })
    .from(proposals)
    .innerJoin(estimates, eq(estimates.id, proposals.estimateId))
    .innerJoin(customers, eq(customers.id, estimates.customerId))
    .leftJoin(followUps, eq(followUps.estimateId, proposals.estimateId))
    .where(
      and(
        inArray(proposals.status, ["sent", "viewed"]),
        isNotNull(proposals.sentTo),
        // Same rule as proposalExpired: still open at the exact expiry instant.
        or(isNull(proposals.expiresAt), gte(proposals.expiresAt, now)),
        lte(lastContact, cutoff),
      ),
    )
    .orderBy(lastContact)
    .limit(limit);
  if (!rows.length) return [];
  const emailed = await db
    .select({ customerId: inboundEmails.customerId, at: sql<Date>`max(${inboundEmails.receivedAt})` })
    .from(inboundEmails)
    .where(and(inArray(inboundEmails.customerId, rows.map((r) => r.customerId)), gte(inboundEmails.receivedAt, new Date(Math.min(...rows.map((r) => new Date(r.sentAt).getTime()))))))
    .groupBy(inboundEmails.customerId);
  const lastEmail = new Map(emailed.map((e) => [e.customerId, new Date(e.at)]));
  return rows.map((r) => {
    const contact = new Date(r.lastContactAt);
    const theirs = lastEmail.get(r.customerId);
    return {
      proposalId: r.proposalId,
      estimateId: r.estimateId,
      number: r.number,
      title: r.title,
      customerName: r.customerName,
      sentAt: new Date(r.sentAt).toISOString(),
      lastContactAt: contact.toISOString(),
      followUps: Number(r.followUps),
      viewCount: r.viewCount,
      customerEmailedAt: theirs && theirs > contact ? theirs.toISOString() : null,
    };
  });
}

/** How many times each of an estimate's proposals has been followed up, and when last. */
export async function followUpHistory(estimateId: string): Promise<{ count: number; lastAt: string | null }> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${outboundMessages.createdAt})` })
    .from(outboundMessages)
    .where(and(eq(outboundMessages.estimateId, estimateId), eq(outboundMessages.templateKey, "proposal_follow_up"), inArray(outboundMessages.status, ["sent", "logged"])));
  return { count: Number(r?.n ?? 0), lastAt: r?.last ? new Date(r.last).toISOString() : null };
}

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activities,
  contacts,
  customers,
  estimateCostItems,
  estimateLines,
  estimates,
  messageTemplates,
  opportunities,
  outboundMessages,
  pipelineStages,
  properties,
  proposals,
  type ProposalAcceptMethod,
} from "@/db/schema";
import { MESSAGE_TEMPLATES } from "@/db/seed-data";
import { sendEmail } from "@/lib/email";
import { calculateDoc, type EstimateDoc } from "@/lib/estimating/document";
import { toDb } from "@/lib/money";
import { formatAddress, formatDate, renderTemplate } from "@/lib/utils";
import { audit } from "./audit";
import { createRevision, loadEstimate, saveEstimateDoc } from "./estimates";
import { moveStage, stageByKey } from "./leads";
import { currentDocuments, visibleDocuments } from "./media";
import { notifyLater, notifyProposalEvent } from "./notifications";
import { createSoldProject } from "./project-status";
import { buildProposalView, normalizeView, type ProposalViewV2 } from "./proposal-view";
import { getCompany, getProposalTemplate } from "./settings";

export { buildProposalView, normalizeView };
export type { ProposalView, ProposalViewV1, ProposalViewV2, ServiceLine } from "./proposal-view";

export class ProposalError extends Error {
  readonly expose = true;
}

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

export const sendProposalSchema = z.object({
  to: z.string().trim().toLowerCase().email("Enter the customer's email").optional().or(z.literal("").transform(() => undefined)),
  /** Shown at the top of the proposal page. */
  message: z.string().trim().max(2000).optional(),
  email: z.boolean().default(true),
  /** The email as the sender edited it; [Proposal link] is replaced with the real link. */
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().max(10_000).optional(),
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
export async function proposalEmailDraft(estimateId: string, sender: { name: string }): Promise<{ to: string; subject: string; body: string } | null> {
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
  if (!estimate) return null;
  const [customer, contact, company, template] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) }),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, estimate.customerId), eq(contacts.isPrimary, true)) }),
    getCompany(),
    proposalTemplate(),
  ]);
  const vars = {
    first_name: contact?.firstName?.trim() || customer?.displayName.split(" ")[0] || "there",
    customer_name: customer?.displayName ?? "",
    job_title: estimate.title,
    proposal_link: PROPOSAL_LINK_TOKEN,
    valid_until: estimate.validUntil ? `This proposal is valid until ${formatDate(estimate.validUntil, { dateStyle: "long" })}.` : "",
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

/** Freeze the estimate as a proposal, optionally email the link. Returns the link either way. */
type LoadedEstimate = NonNullable<Awaited<ReturnType<typeof loadEstimate>>>;

/** The customer-facing view of an estimate as it stands now (used when sending and for the staff draft preview). */
async function viewFor(estimate: LoadedEstimate["estimate"], doc: EstimateDoc, opts: { revision: number; message: string | null }) {
  const [customer, contact, property, company, template] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) }),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, estimate.customerId), eq(contacts.isPrimary, true)) }),
    estimate.propertyId ? db.query.properties.findFirst({ where: eq(properties.id, estimate.propertyId) }) : null,
    getCompany(),
    getProposalTemplate(),
  ]);
  if (!customer) throw new ProposalError("Customer not found");
  const view = buildProposalView({
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
    validUntil: estimate.validUntil,
    company,
    template,
    message: opts.message,
  });
  return { view, customer, company };
}

/** Staff "Preview proposal": what the customer would see if the estimate were sent now. Nothing is saved. */
export async function draftProposal(estimateId: string) {
  const loaded = await loadEstimate(estimateId);
  if (!loaded) return null;
  const { estimate, doc } = loaded;
  const { view } = await viewFor(estimate, doc, { revision: (estimate.revision ?? 0) + 1, message: null });
  const recommended = view.options.filter((o) => o.recommended).map((o) => o.id);
  return { status: "sent", view, initialSelection: recommended, totals: proposalTotals(doc, recommended), accepted: null };
}

export async function draftTotals(estimateId: string, selectedIds: string[]): Promise<ProposalTotals | null> {
  const loaded = await loadEstimate(estimateId);
  if (!loaded) return null;
  const allowed = new Set(optionIds(loaded.doc));
  return proposalTotals(loaded.doc, selectedIds.filter((id) => allowed.has(id)));
}

/** Freezes the estimate as it is now into a new open proposal (replacing any open one). */
async function freezeProposal(
  loaded: LoadedEstimate,
  opts: { message: string | null; to: string | null; reason: string; activity: string | null },
  user: { id: string; name: string },
) {
  const { estimate, doc } = loaded;
  const estimateId = estimate.id;
  if (estimate.status === "accepted") throw new ProposalError("This estimate has already been accepted.");
  if (!doc.lines.length && !doc.costItems.length) throw new ProposalError("Add at least one item before sending a proposal.");
  const revision = await createRevision(estimateId, opts.reason, user.id);
  const { view, customer, company } = await viewFor(estimate, doc, { revision, message: opts.message });
  const token = randomBytes(24).toString("base64url");
  const now = new Date();
  const proposal = await db.transaction(async (tx) => {
    await tx
      .update(proposals)
      .set({ status: "superseded" })
      .where(and(eq(proposals.estimateId, estimateId), inArray(proposals.status, ["sent", "viewed"])));
    const [p] = await tx
      .insert(proposals)
      .values({ estimateId, revision, token, snapshot: doc, view, message: opts.message, sentTo: opts.to, sentBy: user.id, expiresAt: estimate.validUntil })
      .returning();
    await tx.update(estimates).set({ status: "sent", sentAt: now, updatedAt: now }).where(eq(estimates.id, estimateId));
    if (opts.activity) {
      await tx.insert(activities).values({ customerId: estimate.customerId, opportunityId: estimate.opportunityId, type: "estimate", body: opts.activity.replace("{revision}", String(revision)), createdBy: user.id });
    }
    await audit({ actorId: user.id, action: "proposal.send", entityType: "proposal", entityId: p.id, after: { estimateId, revision, to: opts.to } }, tx);
    return p;
  });
  return { proposal, token, view, customer, company };
}

export async function sendProposal(estimateId: string, raw: z.input<typeof sendProposalSchema>, user: { id: string; name: string }) {
  const input = sendProposalSchema.parse(raw);
  const loaded = await loadEstimate(estimateId);
  if (!loaded) throw new ProposalError("Estimate not found");
  const { estimate } = loaded;
  if (input.email && !input.to) throw new ProposalError("Enter the customer's email, or untick 'Email it'.");

  const { proposal, token } = await freezeProposal(
    loaded,
    {
      message: input.message || null,
      to: input.to ?? null,
      reason: "Proposal sent",
      activity: `Proposal for estimate #${estimate.number} (revision {revision}) ${input.email ? `sent to ${input.to}` : "created – link shared manually"}`,
    },
    user,
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
    const draft = input.body && input.subject ? null : await proposalEmailDraft(estimateId, user);
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
      templateKey: "proposal",
      sentBy: user.id,
      sentAt: r.status === "failed" ? null : new Date(),
    });
  }
  return { proposalId: proposal.id, link, emailStatus, emailError };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** Public lookup by link token. Loading it doesn't count as a view (see recordProposalView). */
export async function getProposalForCustomer(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token) });
  if (!p) return null;
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, p.estimateId), columns: { jobType: true } });
  const expired = !!p.expiresAt && p.expiresAt < new Date() && (p.status === "sent" || p.status === "viewed");
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

/**
 * Customer signs. Claims the proposal atomically, locks the estimate to exactly
 * what was signed, creates the project and marks the lead won.
 */
export async function acceptProposal(token: string, raw: unknown, meta: { ip: string | null; userAgent: string | null }) {
  const input = acceptSchema.parse(raw);
  if (!TOKEN_RE.test(token)) throw new ProposalError("This proposal link is not valid.");
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token) });
  if (!p) throw new ProposalError("This proposal link is not valid.");
  if (p.status === "accepted") throw new ProposalError("This proposal has already been accepted. Thank you!");
  if (p.status !== "sent" && p.status !== "viewed") throw new ProposalError("This proposal is no longer open. Please contact us for an updated one.");
  if (p.expiresAt && p.expiresAt < new Date()) throw new ProposalError("This proposal has expired. Please contact us and we'll send an updated one.");
  return completeAcceptance(p, {
    name: input.name,
    email: input.email ?? null,
    signature: input.signature,
    message: input.message || null,
    selected: input.selectedOptionIds,
    method: "online",
    ip: meta.ip,
    userAgent: meta.userAgent,
    markedBy: null,
  });
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
});

/**
 * The office marks an estimate accepted for the customer (they said yes by phone,
 * email, in person or on paper). The estimate is frozen as it is now, exactly as if
 * it had been sent and signed: the estimate locks, the job is created and the lead is won.
 */
export async function acceptProposalForCustomer(estimateId: string, raw: unknown, user: { id: string; name: string }) {
  const input = acceptForCustomerSchema.parse(raw);
  const loaded = await loadEstimate(estimateId);
  if (!loaded) throw new ProposalError("Estimate not found");
  // Always the estimate as it is on screen now, even if an older version was sent.
  const { proposal } = await freezeProposal(loaded, { message: null, to: null, reason: "Accepted by the customer", activity: null }, user);
  return completeAcceptance(proposal, {
    name: input.name,
    email: null,
    signature: null,
    message: input.note || null,
    selected: input.selectedOptionIds,
    method: input.method,
    ip: null,
    userAgent: null,
    markedBy: user,
  });
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
}

/** Claims the proposal atomically, locks the estimate to exactly what was accepted, creates the job and marks the lead won. */
async function completeAcceptance(p: typeof proposals.$inferSelect, a: Acceptance) {
  const doc = p.snapshot as EstimateDoc;
  const allowed = new Set(optionIds(doc));
  const selected = a.selected.filter((id) => allowed.has(id));
  const signedDoc = withSelection(doc, new Set(selected));
  const result = calculateDoc(signedDoc);
  const t = result.totals;
  const totals = { price: t.price.toFixed(2), gst: t.gst.toFixed(2), total: t.total.toFixed(2), deposit: t.deposit.toFixed(2) };
  const acceptedAt = new Date();
  const documentHash = createHash("sha256")
    .update(JSON.stringify({ view: p.view, selected, totals, name: a.name, acceptedAt: acceptedAt.toISOString(), method: a.method, markedBy: a.markedBy?.id ?? null }))
    .digest("hex");

  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, p.estimateId) });
  if (!estimate) throw new ProposalError("This proposal is no longer available.");
  // What the customer was shown, so we can later prove which certificate was current at signing.
  const documentIds = visibleDocuments(await currentDocuments(acceptedAt)).map((x) => x.id);
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) });
  // If the estimate was edited after sending, the customer still gets exactly what they saw.
  if (estimate.status !== "accepted") await saveEstimateDoc(estimate.id, signedDoc);
  const how = a.markedBy ? `accepted ${METHOD_PHRASE[a.method]} by ${a.name} (marked by ${a.markedBy.name})` : `accepted and signed by ${a.name}`;

  const project = await db.transaction(async (tx) => {
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
        acceptedDocumentIds: documentIds,
        acceptedBy: a.markedBy?.id ?? null,
        acceptedMethod: a.method,
      })
      .where(and(eq(proposals.id, p.id), inArray(proposals.status, ["sent", "viewed"])))
      .returning({ id: proposals.id });
    if (!claimed.length) throw new ProposalError("This proposal has already been accepted or replaced.");

    await tx
      .update(proposals)
      .set({ status: "superseded" })
      .where(and(eq(proposals.estimateId, p.estimateId), inArray(proposals.status, ["sent", "viewed"])));
    // Lock the estimate to exactly what was accepted, including the chosen upgrades.
    for (const l of signedDoc.lines.filter((x) => x.isOptional)) {
      await tx.update(estimateLines).set({ optionSelected: l.optionSelected }).where(eq(estimateLines.id, l.id));
    }
    for (const c of signedDoc.costItems.filter((x) => x.isOptional)) {
      await tx.update(estimateCostItems).set({ optionSelected: c.optionSelected }).where(eq(estimateCostItems.id, c.id));
    }
    await tx
      .update(estimates)
      .set({ status: "accepted", acceptedAt, totalHours: toDb(t.hours, 4), totalCost: toDb(t.totalCost), totalPrice: toDb(t.price), totalWithTax: toDb(t.total), updatedAt: acceptedAt })
      .where(eq(estimates.id, p.estimateId));

    const proj = await createSoldProject(
      {
        name: `${customer?.displayName ?? "Customer"} – ${doc.title}`,
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
      { soldAt: acceptedAt, actorId: a.markedBy?.id ?? null, note: a.markedBy ? `Accepted ${METHOD_PHRASE[a.method]} (marked by ${a.markedBy.name})` : "Proposal signed" },
      tx,
    );
    await tx.insert(activities).values({
      customerId: estimate.customerId,
      opportunityId: estimate.opportunityId,
      type: "estimate",
      body: `Proposal for estimate #${estimate.number} ${how}${selected.length ? ` with ${selected.length} optional upgrade(s)` : ""}. Total ${totals.total} incl. GST.${a.markedBy && a.message ? ` Note: ${a.message}` : ""}`,
      meta: { proposalId: p.id, documentHash, method: a.method },
      createdBy: a.markedBy?.id ?? null,
    });
    await audit(
      {
        actorId: a.markedBy?.id ?? null,
        action: a.markedBy ? "proposal.accept_for_customer" : "proposal.accept",
        entityType: "proposal",
        entityId: p.id,
        after: { name: a.name, method: a.method, selected, totals, ip: a.ip, documentHash, ...(a.markedBy && a.message ? { note: a.message } : {}) },
      },
      tx,
    );
    return proj;
  });

  if (estimate.opportunityId) {
    const won = await stageByKey("won");
    await moveStage(estimate.opportunityId, won.id, a.markedBy?.id ?? null).catch((e) => console.error("[proposal] could not mark lead won", e));
  }
  notifyLater(() => notifyProposalEvent("accepted", p.id, { actorId: a.markedBy?.id ?? null }));
  return { projectId: project?.id ?? null, totals };
}

export async function declineProposal(token: string, reason: string | undefined) {
  if (!TOKEN_RE.test(token)) throw new ProposalError("This proposal link is not valid.");
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token) });
  if (!p || (p.status !== "sent" && p.status !== "viewed")) throw new ProposalError("This proposal is no longer open.");
  const clean = reason?.trim().slice(0, 1000) || null;
  await db.update(proposals).set({ status: "declined", declinedAt: new Date(), declineReason: clean }).where(eq(proposals.id, p.id));
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, p.estimateId) });
  if (estimate) {
    await db.update(estimates).set({ status: "declined", updatedAt: new Date() }).where(eq(estimates.id, estimate.id));
    await db.insert(activities).values({
      customerId: estimate.customerId,
      opportunityId: estimate.opportunityId,
      type: "estimate",
      body: `Customer declined the proposal for estimate #${estimate.number}${clean ? `: "${clean}"` : ""}`,
    });
  }
  notifyLater(() => notifyProposalEvent("declined", p.id));
}

export async function listProposals(estimateId: string) {
  return db.query.proposals.findMany({
    where: eq(proposals.estimateId, estimateId),
    orderBy: desc(proposals.sentAt),
    columns: { id: true, revision: true, status: true, token: true, sentTo: true, sentAt: true, firstViewedAt: true, viewCount: true, acceptedAt: true, acceptedName: true, acceptedMethod: true, declinedAt: true, declineReason: true, expiresAt: true },
  });
}

export async function withdrawProposal(proposalId: string, userId: string) {
  const res = await db
    .update(proposals)
    .set({ status: "withdrawn" })
    .where(and(eq(proposals.id, proposalId), inArray(proposals.status, ["sent", "viewed"])))
    .returning({ id: proposals.id });
  if (!res.length) throw new ProposalError("Only open proposals can be withdrawn.");
  await audit({ actorId: userId, action: "proposal.withdraw", entityType: "proposal", entityId: proposalId });
}

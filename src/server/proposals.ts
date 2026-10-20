import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activities,
  contacts,
  customers,
  estimateCostItems,
  estimateLines,
  estimates,
  opportunities,
  outboundMessages,
  pipelineStages,
  projects,
  properties,
  proposals,
} from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { calculateDoc, type EstimateDoc } from "@/lib/estimating/document";
import { toDb } from "@/lib/money";
import { formatAddress, formatDate } from "@/lib/utils";
import { audit } from "./audit";
import { createRevision, loadEstimate, saveEstimateDoc } from "./estimates";
import { moveStage, stageByKey } from "./leads";
import { getCompany, getProposalSettings } from "./settings";

export class ProposalError extends Error {
  readonly expose = true;
}

/** Everything the customer sees. Built server-side so costs and notes never leave the server. */
export interface ProposalView {
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

export interface ProposalTotals {
  price: string;
  gst: string;
  total: string;
  deposit: string;
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

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

export function buildProposalView(input: {
  doc: EstimateDoc;
  number: number;
  revision: number;
  customerName: string;
  contactName: string | null;
  address: string | null;
  validUntil: Date | null;
  company: ProposalView["company"];
  settings: Awaited<ReturnType<typeof getProposalSettings>>;
  message: string | null;
}): ProposalView {
  const { doc, settings } = input;
  const result = calculateDoc(doc);
  const lineResult = new Map(result.lines.map((r) => [r.id, r]));
  const areaName = new Map(doc.areas.map((a) => [a.id, a.name]));
  const describe = (l: EstimateDoc["lines"][number]) =>
    [l.rateSnapshot.unit !== "hour" && l.coats > 0 ? `${l.coats} coat${l.coats > 1 ? "s" : ""}` : null, l.colour, l.sheen].filter(Boolean).join(" · ");

  const groups = [...doc.areas.map((a) => ({ id: a.id, name: a.name })), { id: "", name: "General" }];
  const areas = groups
    .map((g) => {
      const ls = doc.lines.filter((l) => (l.areaId ?? "") === g.id && !l.isOptional);
      const price = ls.reduce((s, l) => s + Number(lineResult.get(l.id)?.price ?? 0), 0);
      return {
        id: g.id || "general",
        name: g.name,
        price: settings.showAreaPrices ? price.toFixed(2) : null,
        items: ls.map((l) => ({ id: l.id, title: l.customerDescription || l.description, detail: describe(l) })),
      };
    })
    .filter((a) => a.items.length > 0);

  const options = [
    ...doc.lines
      .filter((l) => l.isOptional)
      .map((l) => ({
        id: l.id,
        title: [l.customerDescription || l.description, describe(l)].filter(Boolean).join(" – "),
        area: l.areaId ? (areaName.get(l.areaId) ?? null) : null,
        price: (lineResult.get(l.id)?.price.toFixed(2)) ?? "0.00",
        recommended: l.optionSelected,
      })),
    ...doc.costItems
      .filter((c) => c.isOptional)
      .map((c) => ({
        id: c.id,
        title: c.description,
        area: null,
        price: result.costItems.find((r) => r.id === c.id)?.price.toFixed(2) ?? "0.00",
        recommended: c.optionSelected,
      })),
  ];

  const products = new Map<string, Set<string>>();
  for (const l of doc.lines) {
    const name = l.rateSnapshot.material?.productName;
    if (!name) continue;
    const set = products.get(name) ?? new Set<string>();
    if (l.colour) set.add([l.colour, l.sheen].filter(Boolean).join(", "));
    products.set(name, set);
  }

  return {
    number: input.number,
    revision: input.revision,
    title: doc.title,
    customerName: input.customerName,
    contactName: input.contactName,
    address: input.address,
    issuedOn: formatDate(new Date()),
    validUntil: input.validUntil ? formatDate(input.validUntil) : null,
    company: input.company,
    intro: settings.intro,
    message: input.message,
    customerNotes: doc.customerNotes ?? null,
    showAreaPrices: settings.showAreaPrices,
    areas,
    options,
    products: [...products.entries()].map(([name, colours]) => ({ name, colours: [...colours] })),
    gstRate: doc.settings.gstRate,
    depositPct: doc.settings.depositPct,
    sections: {
      preparation: settings.preparation,
      inclusions: lines(settings.inclusions),
      exclusions: lines(settings.exclusions),
      warranty: settings.warranty,
      paymentTerms: settings.paymentTerms,
      terms: settings.terms,
    },
  };
}

export function proposalUrl(token: string) {
  const base = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
  return `${base}/share/p/${token}`;
}

export const sendProposalSchema = z.object({
  to: z.string().trim().toLowerCase().email("Enter the customer's email").optional().or(z.literal("").transform(() => undefined)),
  message: z.string().trim().max(2000).optional(),
  email: z.boolean().default(true),
});

/** Freeze the estimate as a proposal, optionally email the link. Returns the link either way. */
export async function sendProposal(estimateId: string, raw: z.input<typeof sendProposalSchema>, user: { id: string; name: string }) {
  const input = sendProposalSchema.parse(raw);
  const loaded = await loadEstimate(estimateId);
  if (!loaded) throw new ProposalError("Estimate not found");
  const { estimate, doc } = loaded;
  if (estimate.status === "accepted") throw new ProposalError("This estimate has already been accepted.");
  if (!doc.lines.length && !doc.costItems.length) throw new ProposalError("Add at least one item before sending a proposal.");
  if (input.email && !input.to) throw new ProposalError("Enter the customer's email, or untick 'Email it'.");

  const [customer, contact, property, company, settings] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) }),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, estimate.customerId), eq(contacts.isPrimary, true)) }),
    estimate.propertyId ? db.query.properties.findFirst({ where: eq(properties.id, estimate.propertyId) }) : null,
    getCompany(),
    getProposalSettings(),
  ]);
  if (!customer) throw new ProposalError("Customer not found");

  const revision = await createRevision(estimateId, "Proposal sent", user.id);
  const view = buildProposalView({
    doc,
    number: estimate.number ?? 0,
    revision,
    customerName: customer.displayName,
    contactName: contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null : null,
    address: property ? formatAddress(property) : null,
    validUntil: estimate.validUntil,
    company: { name: company.name, phone: company.phone, email: company.email, address: company.address, gstNumber: company.gstNumber },
    settings,
    message: input.message || null,
  });
  const token = randomBytes(24).toString("base64url");
  const now = new Date();

  const proposal = await db.transaction(async (tx) => {
    await tx
      .update(proposals)
      .set({ status: "superseded" })
      .where(and(eq(proposals.estimateId, estimateId), inArray(proposals.status, ["sent", "viewed"])));
    const [p] = await tx
      .insert(proposals)
      .values({ estimateId, revision, token, snapshot: doc, view, message: input.message || null, sentTo: input.to ?? null, sentBy: user.id, expiresAt: estimate.validUntil })
      .returning();
    await tx.update(estimates).set({ status: "sent", sentAt: now, updatedAt: now }).where(eq(estimates.id, estimateId));
    await tx.insert(activities).values({
      customerId: estimate.customerId,
      opportunityId: estimate.opportunityId,
      type: "estimate",
      body: `Proposal for estimate #${estimate.number} (revision ${revision}) ${input.email ? `sent to ${input.to}` : "created – link shared manually"}`,
      createdBy: user.id,
    });
    await audit({ actorId: user.id, action: "proposal.send", entityType: "proposal", entityId: p.id, after: { estimateId, revision, to: input.to } }, tx);
    return p;
  });

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
    const subject = `Your painting proposal from ${company.name}`;
    const text = [
      `Hi ${view.contactName?.split(" ")[0] || customer.displayName.split(" ")[0]},`,
      "",
      input.message || `Thanks for having us out. Your proposal for ${doc.title} is ready to review.`,
      "",
      `View and accept your proposal: ${link}`,
      view.validUntil ? `This proposal is valid until ${view.validUntil}.` : "",
      "",
      `${user.name}`,
      company.name,
      company.phone,
    ]
      .filter((l) => l !== null)
      .join("\n");
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

/** Public lookup by link token. Staff views don't count as customer views. */
export async function getProposalForCustomer(token: string, opts: { countView: boolean }) {
  if (!TOKEN_RE.test(token)) return null;
  const p = await db.query.proposals.findFirst({ where: eq(proposals.token, token) });
  if (!p) return null;
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, p.estimateId), columns: { customerId: true, opportunityId: true, number: true } });
  const expired = !!p.expiresAt && p.expiresAt < new Date() && (p.status === "sent" || p.status === "viewed");
  if (opts.countView && (p.status === "sent" || p.status === "viewed")) {
    const now = new Date();
    await db
      .update(proposals)
      .set({ status: "viewed", firstViewedAt: p.firstViewedAt ?? now, lastViewedAt: now, viewCount: p.viewCount + 1 })
      .where(eq(proposals.id, p.id));
    if (!p.firstViewedAt && estimate) {
      await db.insert(activities).values({
        customerId: estimate.customerId,
        opportunityId: estimate.opportunityId,
        type: "estimate",
        body: `Customer opened the proposal for estimate #${estimate.number}`,
      });
    }
  }
  const doc = p.snapshot as EstimateDoc;
  const view = p.view as ProposalView;
  const recommended = view.options.filter((o) => o.recommended).map((o) => o.id);
  return {
    id: p.id,
    status: expired ? ("expired" as const) : p.status,
    view,
    initialSelection: p.status === "accepted" ? (p.selectedOptionIds ?? []) : recommended,
    totals: p.status === "accepted" && p.acceptedTotals ? (p.acceptedTotals as unknown as ProposalTotals) : proposalTotals(doc, recommended),
    accepted:
      p.status === "accepted"
        ? { name: p.acceptedName ?? "", at: p.acceptedAt?.toISOString() ?? "", signature: p.signature ?? "", hash: p.documentHash ?? "" }
        : null,
  };
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

  const doc = p.snapshot as EstimateDoc;
  const allowed = new Set(optionIds(doc));
  const selected = input.selectedOptionIds.filter((id) => allowed.has(id));
  const signedDoc = withSelection(doc, new Set(selected));
  const result = calculateDoc(signedDoc);
  const t = result.totals;
  const totals = { price: t.price.toFixed(2), gst: t.gst.toFixed(2), total: t.total.toFixed(2), deposit: t.deposit.toFixed(2) };
  const acceptedAt = new Date();
  const documentHash = createHash("sha256")
    .update(JSON.stringify({ view: p.view, selected, totals, name: input.name, acceptedAt: acceptedAt.toISOString() }))
    .digest("hex");

  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, p.estimateId) });
  if (!estimate) throw new ProposalError("This proposal is no longer available.");
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) });
  // If the estimate was edited after sending, the customer still gets exactly what they saw.
  if (estimate.status !== "accepted") await saveEstimateDoc(estimate.id, signedDoc);

  const project = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(proposals)
      .set({
        status: "accepted",
        acceptedAt,
        acceptedName: input.name,
        acceptedEmail: input.email ?? null,
        signature: input.signature,
        acceptedIp: meta.ip,
        acceptedUserAgent: meta.userAgent?.slice(0, 500) ?? null,
        selectedOptionIds: selected,
        acceptedTotals: totals,
        documentHash,
      })
      .where(and(eq(proposals.id, p.id), inArray(proposals.status, ["sent", "viewed"])))
      .returning({ id: proposals.id });
    if (!claimed.length) throw new ProposalError("This proposal has already been accepted or replaced.");

    await tx
      .update(proposals)
      .set({ status: "superseded" })
      .where(and(eq(proposals.estimateId, p.estimateId), inArray(proposals.status, ["sent", "viewed"])));
    // Lock the estimate to exactly what was signed, including the chosen upgrades.
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

    const [proj] = await tx
      .insert(projects)
      .values({
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
      })
      .onConflictDoNothing({ target: projects.estimateId })
      .returning();
    await tx.insert(activities).values({
      customerId: estimate.customerId,
      opportunityId: estimate.opportunityId,
      type: "estimate",
      body: `Proposal for estimate #${estimate.number} accepted and signed by ${input.name}${selected.length ? ` with ${selected.length} optional upgrade(s)` : ""}. Total ${totals.total} incl. GST.`,
      meta: { proposalId: p.id, documentHash },
    });
    await audit({ actorId: null, action: "proposal.accept", entityType: "proposal", entityId: p.id, after: { name: input.name, selected, totals, ip: meta.ip, documentHash } }, tx);
    return proj;
  });

  if (estimate.opportunityId) {
    const won = await stageByKey("won");
    await moveStage(estimate.opportunityId, won.id, null).catch((e) => console.error("[proposal] could not mark lead won", e));
  }
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
}

export async function listProposals(estimateId: string) {
  return db.query.proposals.findMany({
    where: eq(proposals.estimateId, estimateId),
    orderBy: desc(proposals.sentAt),
    columns: { id: true, revision: true, status: true, token: true, sentTo: true, sentAt: true, firstViewedAt: true, viewCount: true, acceptedAt: true, acceptedName: true, declinedAt: true, declineReason: true, expiresAt: true },
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

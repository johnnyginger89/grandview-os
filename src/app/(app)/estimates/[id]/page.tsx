import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { contacts, customers, projects, properties } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatAddress } from "@/lib/utils";
import { leadSummary, openLeadsFor } from "@/server/estimate-lead";
import { listRevisions, listTemplates, loadEstimate, recentColours } from "@/server/estimates";
import { followUpHistory, listProposals, proposalEmailDraft, proposalExpired, proposalUrl } from "@/server/proposals";
import { listFactors, listMaterialOptions, listRates, toSnapshot } from "@/server/rates";
import { getEstimatingPresets, getPricing, getProposalTemplate } from "@/server/settings";
import { resolveJobType } from "@/lib/proposal-template/resolve";
import { JOB_TYPE_KEYS } from "@/lib/proposal-template/schema";
import { CompanyCamSection } from "@/components/companycam/companycam-section";
import { EstimateEditor } from "./editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Estimate ${(await params).id.slice(0, 8)}` };
}

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requirePermission("estimates.read");
  const loaded = await loadEstimate(id);
  if (!loaded) notFound();
  const { estimate, doc } = loaded;
  const now = new Date();

  const canEdit = can(user.role, "estimates.write");
  const [customer, places, rates, factors, templates, revisions, pricing, proposalRows, contact, project, template, emailDraft, followUps, presets, recent, materials, lead, leadChoices] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) }),
    // The customer's addresses, for the job address in the header.
    db.query.properties.findMany({ where: eq(properties.customerId, estimate.customerId), orderBy: asc(properties.createdAt) }),
    listRates(),
    listFactors(),
    listTemplates(),
    listRevisions(id),
    getPricing(),
    listProposals(id),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, estimate.customerId), eq(contacts.isPrimary, true)) }),
    db.query.projects.findFirst({ where: eq(projects.estimateId, id), columns: { id: true, number: true } }),
    getProposalTemplate(),
    proposalEmailDraft(id, user, now),
    followUpHistory(id),
    getEstimatingPresets(),
    recentColours(),
    // $/gal goes to the browser only for logins that may see costs.
    can(user.role, "estimates.costing") ? listMaterialOptions() : [],
    estimate.opportunityId ? leadSummary(estimate.opportunityId) : null,
    // A sold estimate keeps its lead.
    canEdit && estimate.status !== "accepted" ? openLeadsFor(estimate.customerId) : [],
  ]);
  const proposalText = Object.fromEntries(
    JOB_TYPE_KEYS.map((k) => {
      const r = resolveJobType(template, k);
      return [k, { preparation: r.preparation[0]?.body ?? "", areasExcluded: r.areasExcludedDefault }];
    }),
  );

  return (
    <>
      <nav className="mb-2 text-sm text-muted">
        <Link href="/estimates" className="hover:text-text">Estimates</Link> /{" "}
        <Link href={`/customers/${estimate.customerId}`} className="hover:text-text">{customer?.displayName}</Link>
      </nav>
      <EstimateEditor
        estimate={{
          id: estimate.id,
          number: estimate.number ?? 0,
          status: estimate.status,
          revision: estimate.revision,
          customerId: estimate.customerId,
          customerName: customer?.displayName ?? "",
          propertyId: estimate.propertyId,
          addresses: places.map((p) => ({ id: p.id, label: formatAddress(p) || p.street })),
          opportunityId: estimate.opportunityId,
          updatedAt: estimate.updatedAt.toISOString(),
          // Only people who can open the job page get a link to it.
          project: project ? { id: project.id, number: project.number, canOpen: can(user.role, "projects.read_all") } : null,
        }}
        initialDoc={doc}
        rates={rates.filter((r) => r.version).map((r) => ({ id: r.rate.id, code: r.rate.code, category: r.rate.category, dimensionSource: r.rate.dimensionSource, snapshot: toSnapshot(r) }))}
        factors={factors.map((f) => ({ kind: f.kind, label: f.label, value: f.value, isDefault: f.isDefault }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
        revisions={revisions.map((r) => ({ revision: r.revision, reason: r.reason, totals: r.totals, createdAt: r.createdAt.toISOString() }))}
        hoursPerDay={pricing.hoursPerCrewDay}
        canEdit={canEdit && estimate.status !== "accepted"}
        showCosting={can(user.role, "estimates.costing")}
        proposalText={proposalText}
        canEditWording={can(user.role, "settings.manage")}
        presets={presets}
        recentColours={recent}
        materials={materials}
        lead={{
          lead: lead ? { ...lead, visitAt: lead.visitAt?.toISOString() ?? null } : null,
          choices: leadChoices,
          canOpenLead: can(user.role, "pipeline.read"),
        }}
        proposals={{
          canSend: canEdit && estimate.status !== "accepted",
          unlinkedLead: !estimate.opportunityId && leadChoices.length > 0,
          addressMissing: !estimate.propertyId,
          // Filled in by the editor from what's on screen.
          unpriced: [],
          customerName: customer?.displayName ?? "",
          followUps,
          defaultEmail: contact?.email ?? customer?.email ?? "",
          emailDraft: emailDraft ?? { subject: "", body: "" },
          acceptName: (contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") : "") || customer?.displayName || "",
          rows: proposalRows.map((p) => ({
            id: p.id, revision: p.revision, status: p.status, link: proposalUrl(p.token), sentTo: p.sentTo, sentAt: p.sentAt.toISOString(),
            firstViewedAt: p.firstViewedAt?.toISOString() ?? null, viewCount: p.viewCount, acceptedAt: p.acceptedAt?.toISOString() ?? null,
            acceptedName: p.acceptedName, acceptedMethod: p.acceptedMethod, declineReason: p.declineReason,
            expiresAt: p.expiresAt?.toISOString() ?? null, expired: proposalExpired(p, now),
          })),
        }}
      />
      <div className="mt-4">
        <CompanyCamSection entityType="estimate" entityId={id} />
      </div>
    </>
  );
}

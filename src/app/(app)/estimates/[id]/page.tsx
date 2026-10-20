import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { contacts, customers, projects, properties } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatAddress } from "@/lib/utils";
import { listRevisions, listTemplates, loadEstimate } from "@/server/estimates";
import { listProposals, proposalUrl } from "@/server/proposals";
import { ProposalsPanel } from "./proposals-panel";
import { listFactors, listRates, toSnapshot } from "@/server/rates";
import { getPricing } from "@/server/settings";
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

  const [customer, property, rates, factors, templates, revisions, pricing, proposalRows, contact, project] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, estimate.customerId) }),
    estimate.propertyId ? db.query.properties.findFirst({ where: eq(properties.id, estimate.propertyId) }) : null,
    listRates(),
    listFactors(),
    listTemplates(),
    listRevisions(id),
    getPricing(),
    listProposals(id),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, estimate.customerId), eq(contacts.isPrimary, true)) }),
    db.query.projects.findFirst({ where: eq(projects.estimateId, id), columns: { id: true, number: true } }),
  ]);

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
          customerName: customer?.displayName ?? "",
          address: property ? formatAddress(property) : null,
          opportunityId: estimate.opportunityId,
          validUntil: estimate.validUntil?.toISOString() ?? null,
          updatedAt: estimate.updatedAt.toISOString(),
        }}
        initialDoc={doc}
        rates={rates.filter((r) => r.version).map((r) => ({ id: r.rate.id, code: r.rate.code, category: r.rate.category, dimensionSource: r.rate.dimensionSource, snapshot: toSnapshot(r) }))}
        factors={factors.map((f) => ({ kind: f.kind, label: f.label, value: f.value, isDefault: f.isDefault }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
        revisions={revisions.map((r) => ({ revision: r.revision, reason: r.reason, totals: r.totals, createdAt: r.createdAt.toISOString() }))}
        hoursPerDay={pricing.hoursPerCrewDay}
        canEdit={can(user.role, "estimates.write") && estimate.status !== "accepted"}
        showCosting={can(user.role, "estimates.costing")}
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ProposalsPanel
          estimateId={id}
          canSend={can(user.role, "estimates.write") && estimate.status !== "accepted"}
          defaultEmail={contact?.email ?? customer?.email ?? ""}
          rows={proposalRows.map((p) => ({
            id: p.id, revision: p.revision, status: p.status, link: proposalUrl(p.token), sentTo: p.sentTo, sentAt: p.sentAt.toISOString(),
            firstViewedAt: p.firstViewedAt?.toISOString() ?? null, viewCount: p.viewCount, acceptedAt: p.acceptedAt?.toISOString() ?? null,
            acceptedName: p.acceptedName, declineReason: p.declineReason,
          }))}
        />
        {project && (
          <Link href={`/projects/${project.id}`} className="self-start rounded-lg border border-success/30 bg-success-soft p-4 text-sm text-success hover:underline">
            Accepted – project #{project.number} was created automatically. Open project →
          </Link>
        )}
      </div>
    </>
  );
}

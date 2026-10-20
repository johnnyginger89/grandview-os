import { and, asc, desc, eq } from "drizzle-orm";
import { ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { activities, contacts, customers, estimates, opportunities, pipelineStages, properties, user } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatCAD } from "@/lib/money";
import { formatAddress, formatDateTime, mapsUrl } from "@/lib/utils";
import { channelLabel, markViewed } from "@/server/leads";
import { getList } from "@/server/settings";
import { ActivityComposer, BookingLinkButton, StageSelect } from "./lead-actions";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const me = await requirePermission("pipeline.read");
  const opp = await db.query.opportunities.findFirst({ where: eq(opportunities.id, id) });
  if (!opp) notFound();

  const [customer, contact, property, stages, timeline, lostReasons, estimator, oppEstimates] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, opp.customerId) }),
    db.query.contacts.findFirst({ where: and(eq(contacts.customerId, opp.customerId), eq(contacts.isPrimary, true)) }),
    opp.propertyId ? db.query.properties.findFirst({ where: eq(properties.id, opp.propertyId) }) : null,
    db.select().from(pipelineStages).orderBy(asc(pipelineStages.position)),
    db
      .select({ a: activities, author: user.name })
      .from(activities)
      .leftJoin(user, eq(user.id, activities.createdBy))
      .where(eq(activities.opportunityId, id))
      .orderBy(desc(activities.createdAt))
      .limit(100),
    getList("lost_reasons"),
    opp.estimatorId ? db.query.user.findFirst({ where: eq(user.id, opp.estimatorId) }) : null,
    db.query.estimates.findMany({ where: eq(estimates.opportunityId, id), orderBy: desc(estimates.createdAt) }),
  ]);
  if (!customer) notFound();
  if (can(me.role, "pipeline.write")) await markViewed(id, me.id);

  const stage = stages.find((s) => s.id === opp.stageId);
  const email = contact?.email ?? customer.email;
  const phone = contact?.phone ?? customer.phone;
  const address = property ? formatAddress(property) : null;
  const canWrite = can(me.role, "pipeline.write");

  return (
    <>
      <PageHeader
        title={customer.displayName}
        description={<span>Lead #{opp.number} · {channelLabel(opp.channel)}{opp.source ? ` · heard via ${opp.source}` : ""}</span>}
        actions={
          <>
            {canWrite && <StageSelect opportunityId={id} stageId={opp.stageId} stages={stages.map(({ id, name, kind }) => ({ id, name, kind }))} lostReasons={lostReasons} />}
            {can(me.role, "estimates.write") && (
              <LinkButton variant="secondary" href={`/estimates/new?opportunity=${id}`}>Create estimate</LinkButton>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader title="Contact" action={<Link href={`/customers/${customer.id}`} className="text-xs text-brand hover:underline">Customer record</Link>} />
            <div className="space-y-2 p-4 text-sm">
              {contact && (contact.firstName || contact.lastName) && <p className="font-medium">{contact.firstName} {contact.lastName}</p>}
              {email && <a href={`mailto:${email}`} className="flex items-center gap-2 text-brand hover:underline"><Mail className="size-4" />{email}</a>}
              {phone && <a href={`tel:${phone}`} className="flex items-center gap-2 text-brand hover:underline"><Phone className="size-4" />{phone}</a>}
              {address && <a href={mapsUrl(address)} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-brand hover:underline"><MapPin className="mt-0.5 size-4 shrink-0" />{address}</a>}
              {!email && !phone && <p className="text-muted">No contact details yet.</p>}
            </div>
            {can(me.role, "messages.send") && (
              <div className="border-t border-border p-4">
                <BookingLinkButton opportunityId={id} hasEmail={!!email} />
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Details" />
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 p-4 text-sm">
              <dt className="text-muted">Stage</dt><dd className="col-span-2">{stage?.name}</dd>
              <dt className="text-muted">Project</dt><dd className="col-span-2">{opp.projectTypes.join(", ") || "—"}</dd>
              <dt className="text-muted">Timeline</dt><dd className="col-span-2">{opp.timeline || "—"}</dd>
              <dt className="text-muted">Visit</dt>
              <dd className="col-span-2">
                {opp.estimateVisitAt ? formatDateTime(opp.estimateVisitAt) : "Not booked"}
                {opp.bookingManageUrl && <a href={opp.bookingManageUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-xs text-brand hover:underline">Manage <ExternalLink className="size-3" /></a>}
              </dd>
              <dt className="text-muted">Estimator</dt><dd className="col-span-2">{estimator?.name ?? "—"}</dd>
              <dt className="text-muted">Last contact</dt><dd className="col-span-2">{opp.lastContactedAt ? formatDateTime(opp.lastContactedAt) : "—"}</dd>
              <dt className="text-muted">Follow up</dt><dd className="col-span-2">{opp.nextFollowUpAt ? formatDateTime(opp.nextFollowUpAt) : "—"}</dd>
              {opp.lostReason && <><dt className="text-muted">Lost reason</dt><dd className="col-span-2">{opp.lostReason}</dd></>}
            </dl>
            {opp.description && <p className="whitespace-pre-wrap border-t border-border p-4 text-sm text-muted">{opp.description}</p>}
          </Card>

          <Card>
            <CardHeader title="Estimates" />
            <ul className="divide-y divide-border text-sm">
              {oppEstimates.map((e) => (
                <li key={e.id} className="flex items-center justify-between px-4 py-2.5">
                  <Link href={`/estimates/${e.id}`} className="text-brand hover:underline">#{e.number} {e.title}</Link>
                  <span className="flex items-center gap-2">
                    {can(me.role, "estimates.read") && <span className="tabular text-muted">{formatCAD(e.totalPrice)}</span>}
                    <Badge>{e.status}</Badge>
                  </span>
                </li>
              ))}
              {oppEstimates.length === 0 && <li className="px-4 py-3 text-muted">No estimates yet.</li>}
            </ul>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader title="Activity" />
          {canWrite && <div className="border-b border-border p-4"><ActivityComposer opportunityId={id} /></div>}
          <ol className="divide-y divide-border">
            {timeline.map(({ a, author }) => (
              <li key={a.id} className="px-4 py-3 text-sm">
                <div className="flex items-center gap-2 text-xs text-subtle">
                  <Badge tone={a.type === "email" ? "info" : a.type === "booking" ? "brand" : a.type === "stage_change" ? "neutral" : a.type === "call" ? "success" : "neutral"}>{a.type.replace("_", " ")}</Badge>
                  <span>{formatDateTime(a.createdAt)}</span>
                  {author && <span>· {author}</span>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-text">{a.body}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

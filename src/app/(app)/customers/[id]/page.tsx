import { asc, desc, eq } from "drizzle-orm";
import { Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, LinkButton, PageHeader, Stat } from "@/components/ui";
import { db } from "@/db";
import { activities, contacts, customers, estimates, opportunities, pipelineStages, properties, user } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatCAD } from "@/lib/money";
import { formatAddress, formatDate, formatDateTime, mapsUrl } from "@/lib/utils";
import { AddContactForm, AddPropertyForm, EditCustomer } from "./customer-forms";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requirePermission("customers.read");
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  if (!customer) notFound();

  const [people, props, opps, ests, timeline] = await Promise.all([
    db.query.contacts.findMany({ where: eq(contacts.customerId, id), orderBy: [desc(contacts.isPrimary), asc(contacts.createdAt)] }),
    db.query.properties.findMany({ where: eq(properties.customerId, id), orderBy: asc(properties.createdAt) }),
    db.select({ o: opportunities, stage: pipelineStages.name, kind: pipelineStages.kind }).from(opportunities).innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId)).where(eq(opportunities.customerId, id)).orderBy(desc(opportunities.createdAt)),
    can(me.role, "estimates.read") ? db.query.estimates.findMany({ where: eq(estimates.customerId, id), orderBy: desc(estimates.createdAt) }) : Promise.resolve([]),
    db.select({ a: activities, author: user.name }).from(activities).leftJoin(user, eq(user.id, activities.createdBy)).where(eq(activities.customerId, id)).orderBy(desc(activities.createdAt)).limit(50),
  ]);

  const accepted = ests.filter((e) => e.status === "accepted");
  const lifetime = accepted.reduce((s, e) => s + Number(e.totalPrice), 0);
  const canWrite = can(me.role, "customers.write");

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{customer.displayName} <Badge tone={customer.type === "strata" ? "info" : customer.type === "commercial" ? "brand" : "neutral"}>{customer.type}</Badge></span>}
        description={[customer.source && `Source: ${customer.source}`, `Customer since ${formatDate(customer.createdAt)}`].filter(Boolean).join(" · ")}
        actions={<>
          {can(me.role, "estimates.write") && <LinkButton href={`/estimates/new?customer=${id}`}>New estimate</LinkButton>}
          {canWrite && <EditCustomer customer={{ id, type: customer.type, displayName: customer.displayName, email: customer.email ?? "", phone: customer.phone ?? "", source: customer.source ?? "", tags: customer.tags.join(", "), notes: customer.notes ?? "" }} />}
        </>}
      />

      {can(me.role, "estimates.read") && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Jobs won" value={accepted.length} hint={accepted.length > 1 ? "Repeat customer" : undefined} />
          <Stat label="Lifetime contracted" value={formatCAD(lifetime)} />
          <Stat label="Open estimates" value={ests.filter((e) => e.status === "draft" || e.status === "sent").length} />
          <Stat label="Properties" value={props.length} />
        </div>
      )}

      {customer.tags.length > 0 && <p className="mb-4 flex flex-wrap gap-1.5">{customer.tags.map((t) => <Badge key={t}>{t}</Badge>)}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          {Object.keys(customer.customFields ?? {}).length > 0 && (
            <Card>
              <CardHeader title="Extra details" description={customer.importSource ? `Kept from the ${customer.importSource === "markate" ? "Markate" : customer.importSource} import` : undefined} />
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
                {Object.entries(customer.customFields).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          <Card>
            <CardHeader title="Contacts" />
            <ul className="divide-y divide-border text-sm">
              {people.map((c) => (
                <li key={c.id} className="space-y-1 px-4 py-3">
                  <p className="font-medium">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed"} {c.isPrimary && <Badge tone="brand">Primary</Badge>}</p>
                  {c.title && <p className="text-xs text-muted">{c.title}</p>}
                  {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2 text-brand hover:underline"><Mail className="size-3.5" />{c.email}</a>}
                  {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-brand hover:underline"><Phone className="size-3.5" />{c.phone}</a>}
                </li>
              ))}
              {people.length === 0 && <li className="px-4 py-3 text-muted">No contacts.</li>}
            </ul>
            {canWrite && <div className="border-t border-border p-3"><AddContactForm customerId={id} /></div>}
          </Card>
          <Card>
            <CardHeader title="Properties" />
            <ul className="divide-y divide-border text-sm">
              {props.map((p) => {
                const a = formatAddress(p);
                return (
                  <li key={p.id} className="px-4 py-3">
                    {p.label && <p className="font-medium">{p.label}</p>}
                    <a href={mapsUrl(a)} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-brand hover:underline"><MapPin className="mt-0.5 size-3.5 shrink-0" />{a}</a>
                    {p.strataPlan && <p className="text-xs text-muted">Strata plan {p.strataPlan}</p>}
                    {p.accessNotes && <p className="mt-1 text-xs text-muted">{p.accessNotes}</p>}
                  </li>
                );
              })}
              {props.length === 0 && <li className="px-4 py-3 text-muted">No properties.</li>}
            </ul>
            {canWrite && <div className="border-t border-border p-3"><AddPropertyForm customerId={id} /></div>}
          </Card>
          {customer.notes && <Card><CardHeader title="Notes" /><p className="whitespace-pre-wrap p-4 text-sm text-muted">{customer.notes}</p></Card>}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Leads & opportunities" />
            <ul className="divide-y divide-border text-sm">
              {opps.map(({ o, stage, kind }) => (
                <li key={o.id}><Link href={`/leads/${o.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2">
                  <span>#{o.number} {o.title}</span>
                  <Badge tone={kind === "won" ? "success" : kind === "lost" ? "danger" : "info"}>{stage}</Badge>
                </Link></li>
              ))}
              {opps.length === 0 && <li className="px-4 py-3 text-muted">None.</li>}
            </ul>
          </Card>
          {can(me.role, "estimates.read") && (
            <Card>
              <CardHeader title="Estimates" />
              <ul className="divide-y divide-border text-sm">
                {ests.map((e) => (
                  <li key={e.id}><Link href={`/estimates/${e.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2">
                    <span>#{e.number} {e.title}</span>
                    <span className="flex items-center gap-2"><span className="tabular text-muted">{formatCAD(e.totalPrice)}</span><Badge>{e.status}</Badge></span>
                  </Link></li>
                ))}
                {ests.length === 0 && <li className="px-4 py-3 text-muted">None.</li>}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="History" />
            <ol className="divide-y divide-border text-sm">
              {timeline.map(({ a, author }) => (
                <li key={a.id} className="px-4 py-2.5">
                  <p className="text-xs text-subtle">{formatDateTime(a.createdAt)}{author && ` · ${author}`}</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{a.body}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

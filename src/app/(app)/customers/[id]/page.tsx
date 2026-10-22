import { asc, desc, eq } from "drizzle-orm";
import { Mail, MapPin, Phone, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, LinkButton, PageHeader, Stat } from "@/components/ui";
import { db } from "@/db";
import { activities, contacts, customers, estimates, opportunities, pipelineStages, properties, user } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { customerReach } from "@/lib/customer-reach";
import { formatCAD, sumOf } from "@/lib/money";
import { formatAddress, formatDate, formatDateTime, fullName, mapsUrl } from "@/lib/utils";
import { listColourSelectionsForCustomer } from "@/server/colour-selections";
import { AddContact, AddProperty, ContactActions, EditCustomer, PropertyActions, type ContactDTO, type PropertyDTO } from "./customer-forms";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requirePermission("customers.read");
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  if (!customer) notFound();

  const [people, props, opps, ests, timeline, colours] = await Promise.all([
    db.query.contacts.findMany({ where: eq(contacts.customerId, id), orderBy: [desc(contacts.isPrimary), asc(contacts.createdAt)] }),
    db.query.properties.findMany({ where: eq(properties.customerId, id), orderBy: asc(properties.createdAt) }),
    db.select({ o: opportunities, stage: pipelineStages.name, kind: pipelineStages.kind }).from(opportunities).innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId)).where(eq(opportunities.customerId, id)).orderBy(desc(opportunities.createdAt)),
    can(me.role, "estimates.read") ? db.query.estimates.findMany({ where: eq(estimates.customerId, id), orderBy: desc(estimates.createdAt) }) : Promise.resolve([]),
    db.select({ a: activities, author: user.name }).from(activities).leftJoin(user, eq(user.id, activities.createdBy)).where(eq(activities.customerId, id)).orderBy(desc(activities.createdAt)).limit(50),
    listColourSelectionsForCustomer(id),
  ]);
  const canOpenJobs = can(me.role, "projects.read_all");

  const accepted = ests.filter((e) => e.status === "accepted");
  const lifetime = sumOf(accepted.map((e) => e.totalPrice));
  const canWrite = can(me.role, "customers.write");

  // The primary contact shows (and edits) the email and phone every email and call uses.
  const primary = people.find((c) => c.isPrimary) ?? null;
  const reach = customerReach(customer, primary);
  const contactList: (ContactDTO & { display: string })[] = people.map((c) => {
    const email = (c.isPrimary ? reach.email : c.email) ?? "";
    const phone = (c.isPrimary ? reach.phone : c.phone) ?? "";
    const display = fullName(c.firstName, c.lastName);
    return { id: c.id, name: display || email || phone || "Unnamed contact", display, firstName: c.firstName, lastName: c.lastName, title: c.title ?? "", email, phone, phone2: c.phone2 ?? "", isPrimary: c.isPrimary };
  });
  const primaryName = contactList.find((c) => c.isPrimary)?.name ?? null;

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{customer.displayName} <Badge tone={customer.type === "strata" ? "info" : customer.type === "commercial" ? "brand" : "neutral"}>{customer.type}</Badge></span>}
        description={[customer.source && `Source: ${customer.source}`, `Customer since ${formatDate(customer.createdAt)}`].filter(Boolean).join(" · ")}
        actions={<>
          {can(me.role, "estimates.write") && <LinkButton href={`/estimates/new?customer=${id}`}>New estimate</LinkButton>}
          {canWrite && (
            <EditCustomer
              customer={{ id, type: customer.type, displayName: customer.displayName, email: reach.email ?? "", phone: reach.phone ?? "", source: customer.source ?? "", tags: customer.tags.join(", "), notes: customer.notes ?? "" }}
              primaryName={primaryName}
            />
          )}
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

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
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
          <Card role="region" aria-label="Contacts">
            <CardHeader title="Contacts" />
            {people.length > 0 && !primary && (
              <p className="border-b border-border bg-warning-soft px-4 py-2 text-xs text-warning">No primary contact yet. Emails use the customer&apos;s own email until you make someone primary.</p>
            )}
            <ul className="divide-y divide-border text-sm">
              {contactList.map((c) => (
                <li key={c.id} className="space-y-1 px-4 py-3">
                  <p className="font-medium">{c.display || "Unnamed"} {c.isPrimary && <Badge tone="brand">Primary</Badge>}</p>
                  {c.title && <p className="text-xs text-muted">{c.title}</p>}
                  {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2 break-all text-brand hover:underline"><Mail className="size-3.5 shrink-0" />{c.email}</a>}
                  {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-brand hover:underline"><Phone className="size-3.5 shrink-0" />{c.phone}</a>}
                  {c.phone2 && <a href={`tel:${c.phone2}`} className="flex items-center gap-2 text-brand hover:underline"><Phone className="size-3.5 shrink-0" />{c.phone2} <span className="text-xs text-muted">(other)</span></a>}
                  {canWrite && <ContactActions contact={c} others={contactList.filter((o) => o.id !== c.id).map((o) => ({ id: o.id, name: o.name }))} primaryName={c.isPrimary ? null : primaryName} />}
                </li>
              ))}
              {people.length === 0 && (
                <li className="space-y-1 px-4 py-3">
                  <p className="text-muted">No contacts.</p>
                  {reach.email && <a href={`mailto:${reach.email}`} className="flex items-center gap-2 break-all text-brand hover:underline"><Mail className="size-3.5 shrink-0" />{reach.email}</a>}
                  {reach.phone && <a href={`tel:${reach.phone}`} className="flex items-center gap-2 text-brand hover:underline"><Phone className="size-3.5 shrink-0" />{reach.phone}</a>}
                </li>
              )}
            </ul>
            {canWrite && (
              <div className="border-t border-border p-3">
                <AddContact customerId={id} hasPrimary={!!primary} prefill={people.length ? undefined : { email: reach.email ?? "", phone: reach.phone ?? "" }} />
              </div>
            )}
          </Card>
          <Card role="region" aria-label="Properties">
            <CardHeader title="Properties" />
            <ul className="divide-y divide-border text-sm">
              {props.map((p) => {
                const a = formatAddress(p);
                const view: PropertyDTO = {
                  id: p.id, name: p.label ? `${p.label} – ${p.street}` : p.street, label: p.label ?? "", street: p.street, unit: p.unit ?? "", city: p.city ?? "", province: p.province,
                  postalCode: p.postalCode ?? "", propertyType: p.propertyType ?? "", strataPlan: p.strataPlan ?? "", accessNotes: p.accessNotes ?? "", builtBefore1990: !!p.builtBefore1990,
                };
                return (
                  <li key={p.id} className="space-y-1 px-4 py-3">
                    {p.label && <p className="font-medium">{p.label}</p>}
                    <a href={mapsUrl(a)} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-brand hover:underline"><MapPin className="mt-0.5 size-3.5 shrink-0" />{a}</a>
                    {p.builtBefore1990 && <Badge tone="warning" className="gap-1"><TriangleAlert className="size-3" aria-hidden />Built before 1990</Badge>}
                    {p.strataPlan && <p className="text-xs text-muted">Strata plan {p.strataPlan}</p>}
                    {p.accessNotes && <p className="whitespace-pre-wrap text-xs text-muted">{p.accessNotes}</p>}
                    {canWrite && <PropertyActions property={view} />}
                  </li>
                );
              })}
              {props.length === 0 && <li className="px-4 py-3 text-muted">No properties.</li>}
            </ul>
            {canWrite && <div className="border-t border-border p-3"><AddProperty customerId={id} /></div>}
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
          {colours.length > 0 && (
            <Card role="region" aria-label="Colour selections">
              <CardHeader title="Colour selections" />
              <ul className="divide-y divide-border text-sm">
                {colours.map((c) => {
                  const label = c.signedAt ? `Signed by ${c.signedName}, ${formatDate(c.signedAt)}` : c.status === "sent" ? "Sent, waiting for the customer" : "Being filled in";
                  const text = (
                    <>
                      <span className="block font-medium">Job #{c.projectNumber} · {c.jobTitle}</span>
                      <span className="block text-muted">{label}{c.status === "replaced" ? " (replaced by newer colours)" : ""} · {c.rowCount} {c.rowCount === 1 ? "line" : "lines"}</span>
                    </>
                  );
                  return (
                    <li key={c.id}>
                      {canOpenJobs ? <Link href={`/projects/${c.projectId}/colours/${c.id}`} className="block px-4 py-2.5 hover:bg-surface-2">{text}</Link> : <div className="px-4 py-2.5">{text}</div>}
                    </li>
                  );
                })}
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

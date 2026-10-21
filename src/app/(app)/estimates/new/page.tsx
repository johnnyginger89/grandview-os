import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { customers, opportunities, properties } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { listTemplates } from "@/server/estimates";
import { NewEstimateForm } from "./form";

export const metadata = { title: "New estimate" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ customer?: string; opportunity?: string }> }) {
  await requirePermission("estimates.write");
  const { customer, opportunity } = await searchParams;
  const opp = opportunity && UUID.test(opportunity) ? await db.query.opportunities.findFirst({ where: eq(opportunities.id, opportunity) }) : null;
  const customerId = opp?.customerId ?? (customer && UUID.test(customer) ? customer : null);
  const [c, p, templates] = await Promise.all([
    customerId ? db.query.customers.findFirst({ where: eq(customers.id, customerId), columns: { id: true, displayName: true } }) : null,
    customerId ? db.query.properties.findFirst({ where: eq(properties.customerId, customerId), columns: { street: true, city: true } }) : null,
    listTemplates(),
  ]);
  return (
    <>
      <PageHeader title="New estimate" />
      <NewEstimateForm
        customer={c ? { id: c.id, name: c.displayName, detail: [p?.street, p?.city].filter(Boolean).join(", ") } : null}
        opportunityId={opp?.id ?? ""}
        defaultTitle={opp?.projectTypes.join(" & ") ?? ""}
        templates={templates.map((t) => ({ id: t.id, name: t.name, jobType: t.jobType }))}
      />
    </>
  );
}

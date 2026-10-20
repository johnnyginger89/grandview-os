import { asc, eq, isNull } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { customers, opportunities } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { NewEstimateForm } from "./form";

export const metadata = { title: "New estimate" };

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ customer?: string; opportunity?: string }> }) {
  await requirePermission("estimates.write");
  const { customer, opportunity } = await searchParams;
  const opp = opportunity && /^[0-9a-f-]{36}$/i.test(opportunity) ? await db.query.opportunities.findFirst({ where: eq(opportunities.id, opportunity) }) : null;
  const list = await db.select({ id: customers.id, name: customers.displayName }).from(customers).where(isNull(customers.archivedAt)).orderBy(asc(customers.displayName)).limit(2000);
  const defaultTitle = opp?.projectTypes.join(" & ") ?? "";
  return (
    <>
      <PageHeader title="New estimate" />
      <NewEstimateForm customers={list} defaultCustomer={opp?.customerId ?? customer ?? ""} opportunityId={opp?.id ?? ""} defaultTitle={defaultTitle} />
    </>
  );
}

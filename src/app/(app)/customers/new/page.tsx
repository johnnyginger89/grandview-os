import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/authz/guard";
import { getList } from "@/server/settings";
import { NewCustomerForm } from "./form";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  await requirePermission("customers.write");
  return (
    <>
      <PageHeader title="New customer" />
      <NewCustomerForm sources={await getList("lead_sources")} />
    </>
  );
}

import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/authz/guard";
import { getList } from "@/server/settings";
import { NewLeadForm } from "./new-lead-form";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  await requirePermission("pipeline.write");
  const [sources, projectTypes] = await Promise.all([getList("lead_sources"), getList("project_types")]);
  return (
    <>
      <PageHeader title="New lead" description="Only a name and one way to reach them are needed. Everything else can be filled in later." />
      <NewLeadForm sources={sources} projectTypes={projectTypes} />
    </>
  );
}

import { EmptyState, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/authz/guard";

export const metadata = { title: "My Jobs" };

export default async function MyJobs() {
  const user = await requirePermission("projects.read_assigned");
  return (
    <>
      <PageHeader title="My Jobs" description={`Signed in as ${user.name}`} />
      <EmptyState title="No jobs assigned to you yet" description="When a project manager schedules you on a job, it will show up here with the work order, address and checklist." />
    </>
  );
}

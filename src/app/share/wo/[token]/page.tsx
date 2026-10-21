import { notFound } from "next/navigation";
import { updateNotice, WorkOrderDocument } from "@/components/work-order/work-order-document";
import { getCurrentUser } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { getWorkOrderForToken, officeContact, sitePhotos } from "@/server/work-orders";

// Revoking or expiring a link must take effect on the next request.
export const dynamic = "force-dynamic";

export default async function SharedWorkOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const viewer = await getCurrentUser();
  // The office checking a link isn't the crew opening it.
  const staff = !!viewer && can(viewer.role, "projects.read_all");
  const data = await getWorkOrderForToken(token, { countOpen: !staff });
  if (!data) notFound();
  const [office, photos] = await Promise.all([officeContact(), sitePhotos(data.projectId)]);
  return (
    <WorkOrderDocument
      view={data.view}
      office={office}
      changed={data.update?.changed ?? []}
      notice={data.update ? updateNotice(data.view, data.update.fromVersion, data.update.changed.length) : null}
      sitePhotos={photos}
    />
  );
}

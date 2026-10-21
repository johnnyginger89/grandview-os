import { ChevronLeft } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RememberSeenVersion } from "@/components/work-order/print-button";
import { updateNotice, WorkOrderDocument } from "@/components/work-order/work-order-document";
import { requireUser } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { getWorkOrderForCrewMember, getWorkOrderForStaff, officeContact, type CrewWorkOrder } from "@/server/work-orders";

export const metadata = { title: "Work order" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Staff who aren't on the crew can still read the current issued version (no change tracking for them). */
async function forStaff(id: string): Promise<CrewWorkOrder | null> {
  const s = await getWorkOrderForStaff(id);
  return s && s.status === "issued" && s.shown.kind === "version" ? { view: s.view, update: null } : null;
}

export default async function CrewWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await requireUser();
  const path = `/my-jobs/work-orders/${id}`;
  // Which version this device opened last (set below), for the "Updated" banner.
  const seenRaw = (await cookies()).get("wo_seen")?.value ?? "";
  const seenVersion = /^\d{1,4}$/.test(seenRaw) ? Number(seenRaw) : null;

  const crew = await getWorkOrderForCrewMember(user, id, { seenVersion });
  const data = crew ?? (can(user.role, "projects.read_all") ? await forStaff(id) : null);
  if (!data) notFound();
  const office = await officeContact();

  return (
    <div className="-mx-4 -mt-6 sm:mx-0 sm:mt-0">
      <Link href="/my-jobs" className="mb-3 ml-4 mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand hover:underline sm:ml-0 sm:mt-0 print:hidden">
        <ChevronLeft className="size-4" aria-hidden /> My Jobs
      </Link>
      <WorkOrderDocument
        view={data.view}
        office={office}
        changed={data.update?.changed ?? []}
        notice={data.update ? updateNotice(data.view, data.update.fromVersion, data.update.changed.length) : null}
      />
      {crew && <RememberSeenVersion path={path} version={data.view.version} />}
    </div>
  );
}

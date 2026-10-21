import Link from "next/link";
import { notFound } from "next/navigation";
import { ColourForm, SignedCopy } from "@/components/colours/colour-form";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { getColourFormForStaff } from "@/server/colour-selections";
import { saveColoursAction, signColoursAction } from "../actions";

export const metadata = { title: "Colour selections" };

/** The office's (or colour consultant's) copy of a colour form; the customer signs at the bottom on this device. */
export default async function StaffColourFormPage({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  const user = await requirePermission("projects.read_all");
  const data = await getColourFormForStaff(sid);
  if (!data || data.projectId !== id || data.status === "cancelled") notFound();
  const open = data.status === "draft" || data.status === "sent";
  const canEdit = open && can(user.role, "projects.write");
  return (
    <>
      <nav className="mb-3 text-sm text-muted print:hidden">
        <Link href={`/projects/${id}#colours`} className="hover:text-text">← Back to job #{data.projectNumber}</Link>
      </nav>
      {open && canEdit && (
        <p className="mx-auto mb-4 max-w-4xl rounded-lg bg-info-soft px-4 py-3 text-sm text-info print:hidden">
          Fill in the colours with the customer, then hand them the device to tick the two notes and sign at the bottom. Or save it and send them a link from the job page.
          {data.link?.sentAt ? ` A link was sent ${data.link.sentTo ? `to ${data.link.sentTo} ` : ""}on ${new Date(data.link.sentAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium" })}.` : ""}
        </p>
      )}
      {data.signed ? (
        <SignedCopy data={data} />
      ) : (
        <ColourForm data={data} mode="staff" save={canEdit ? saveColoursAction.bind(null, sid) : undefined} sign={canEdit ? signColoursAction.bind(null, sid) : undefined} />
      )}
    </>
  );
}

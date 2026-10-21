import Link from "next/link";
import { notFound } from "next/navigation";
import { ColourForm, SignedCopy } from "@/components/colours/colour-form";
import { requireUser } from "@/lib/authz/guard";
import { colourConsultProject, currentColourForm } from "@/server/colour-selections";
import { saveFieldColoursAction, signFieldColoursAction } from "../actions";
import { StartColoursButton } from "./start-button";

export const metadata = { title: "Colour form" };

/** The colour consultant's form for a booked colour consult: fill it in with the customer, who signs on the device. */
export default async function FieldColourFormPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const user = await requireUser();
  const projectId = await colourConsultProject(user.id, entryId);
  if (!projectId) notFound();
  const data = await currentColourForm(projectId);
  return (
    <>
      <nav className="mb-3 text-sm text-muted print:hidden">
        <Link href="/my-jobs" className="hover:text-text">← My Jobs</Link>
      </nav>
      {!data ? (
        <div className="mx-auto max-w-xl rounded-xl border border-border bg-surface p-6 text-center">
          <h1 className="text-lg font-semibold text-heading">Colour form</h1>
          <p className="mt-2 text-sm text-muted">Start the form for this job. It lists the rooms and surfaces from the estimate; fill in the colours with the customer, then hand them the device to sign.</p>
          <div className="mt-4"><StartColoursButton entryId={entryId} /></div>
        </div>
      ) : data.signed ? (
        <div className="space-y-4">
          <SignedCopy data={data} />
          <div className="mx-auto max-w-4xl print:hidden"><StartColoursButton entryId={entryId} label="Change colours" /></div>
        </div>
      ) : (
        <ColourForm data={data} mode="staff" save={saveFieldColoursAction.bind(null, entryId, data.id)} sign={signFieldColoursAction.bind(null, entryId, data.id)} />
      )}
    </>
  );
}

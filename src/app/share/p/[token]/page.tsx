import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProposalPresentation } from "@/components/proposal/presentation";
import { getCurrentUser } from "@/lib/authz/guard";
import { buildPresentation } from "@/server/proposal-presentation";
import { getProposalForCustomer } from "@/server/proposals";
import { acceptAction, declineAction, previewTotalsAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your proposal", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const staff = await getCurrentUser();
  const data = await getProposalForCustomer(token, { countView: !staff });
  if (!data) notFound();
  const mode = staff ? "staff" : "customer";
  const presentation = await buildPresentation(data.view, { token, mode });
  return (
    <ProposalPresentation
      mode={mode}
      data={data}
      presentation={presentation}
      preview={previewTotalsAction.bind(null, token)}
      acceptAction={mode === "customer" ? acceptAction.bind(null, token) : undefined}
      declineAction={mode === "customer" ? declineAction.bind(null, token) : undefined}
    />
  );
}

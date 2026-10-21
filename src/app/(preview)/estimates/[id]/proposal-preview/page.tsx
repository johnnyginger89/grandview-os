import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProposalPresentation } from "@/components/proposal/presentation";
import { requirePermission } from "@/lib/authz/guard";
import { buildPresentation } from "@/server/proposal-presentation";
import { draftProposal } from "@/server/proposals";
import { previewDraftTotalsAction } from "../../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proposal preview" };

export default async function DraftProposalPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("estimates.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await draftProposal(id);
  if (!data) notFound();
  const presentation = await buildPresentation(data.view, { mode: "draft" });
  return <ProposalPresentation mode="draft" data={data} presentation={presentation} preview={previewDraftTotalsAction.bind(null, id)} />;
}

import type { Metadata } from "next";
import { ProposalPresentation } from "@/components/proposal/presentation";
import { requirePermission } from "@/lib/authz/guard";
import { buildPresentation } from "@/server/proposal-presentation";
import { sampleProposal } from "@/server/proposal-sample";
import { previewSampleTotalsAction } from "../../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sample proposal" };

export default async function SampleProposalPage({ searchParams }: { searchParams: Promise<{ jobType?: string }> }) {
  await requirePermission("settings.manage");
  const jobType = String((await searchParams).jobType ?? "interior");
  const data = await sampleProposal(jobType);
  const presentation = await buildPresentation(data.view, { mode: "sample" });
  return <ProposalPresentation mode="sample" data={data} presentation={presentation} preview={previewSampleTotalsAction.bind(null, data.view.jobType)} />;
}

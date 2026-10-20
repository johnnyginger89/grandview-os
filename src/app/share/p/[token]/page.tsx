import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/authz/guard";
import { getProposalForCustomer } from "@/server/proposals";
import { ProposalDocument } from "./proposal-document";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your proposal", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const staff = await getCurrentUser();
  const data = await getProposalForCustomer(token, { countView: !staff });
  if (!data) notFound();
  return <ProposalDocument token={token} data={data} staffPreview={!!staff} />;
}

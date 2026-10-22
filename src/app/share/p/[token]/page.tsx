import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isClosedStatus, ProposalClosed } from "@/components/proposal/closed";
import { ProposalPresentation } from "@/components/proposal/presentation";
import { getCurrentUser } from "@/lib/authz/guard";
import { proposalPageMode } from "@/lib/sign-on-device";
import { buildPresentation } from "@/server/proposal-presentation";
import { getProposalForCustomer } from "@/server/proposals";
import { getCompany } from "@/server/settings";
import { acceptAction, declineAction, previewTotalsAction, recordViewAction } from "./actions";
import { ViewBeacon } from "./view-beacon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your proposal", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const staff = await getCurrentUser();
  const data = await getProposalForCustomer(token);
  if (!data) notFound();
  // Staff get a read-only preview, unless they're handing the screen to the customer to sign.
  const mode = proposalPageMode(!!staff, await searchParams);
  if (mode === "customer" && isClosedStatus(data.status)) {
    const company = await getCompany();
    return <ProposalClosed status={data.status} company={{ name: company.displayName || company.name, phone: company.phone || null, email: company.email || null }} />;
  }
  const presentation = await buildPresentation(data.view, { token, mode });
  return (
    <>
      {/* Staff screens are never counted as the customer looking. */}
      {!staff && <ViewBeacon record={recordViewAction.bind(null, token)} />}
      <ProposalPresentation
        mode={mode}
        data={data}
        presentation={presentation}
        preview={previewTotalsAction.bind(null, token)}
        acceptAction={mode === "customer" ? acceptAction.bind(null, token) : undefined}
        declineAction={mode === "customer" ? declineAction.bind(null, token) : undefined}
      />
    </>
  );
}

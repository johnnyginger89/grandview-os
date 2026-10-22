import { Card } from "@/components/ui";

const MESSAGE = {
  withdrawn: "This proposal is no longer available.",
  superseded: "There's a newer version of this proposal. Please use the link in our latest email.",
  expired: "This proposal has expired. Prices and schedules change, so we'll gladly send you an updated one.",
} as const;

export type ClosedStatus = keyof typeof MESSAGE;

export function isClosedStatus(status: string): status is ClosedStatus {
  return status in MESSAGE;
}

/**
 * What a customer sees on a proposal link that was withdrawn, replaced or has expired: no name,
 * address or prices, since the link may have gone to the wrong person. Staff still see the proposal.
 */
export function ProposalClosed({ status, company }: { status: ClosedStatus; company: { name: string; phone: string | null; email: string | null } }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <Card className="space-y-3 p-6 text-center">
        <h1 className="text-lg font-semibold">{company.name}</h1>
        <p role="status">{MESSAGE[status]}</p>
        {(company.phone || company.email) && (
          <p className="text-sm text-muted">
            Questions? {company.phone && <>Call <a className="text-brand hover:underline" href={`tel:${company.phone}`}>{company.phone}</a></>}
            {company.phone && company.email && " or "}
            {company.email && <>email <a className="text-brand hover:underline" href={`mailto:${company.email}`}>{company.email}</a></>}.
          </p>
        )}
      </Card>
    </main>
  );
}

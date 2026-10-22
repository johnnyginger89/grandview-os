import type { UnpricedSurface } from "@/lib/estimating/unpriced";

export interface ProposalRow {
  id: string;
  revision: number;
  status: string;
  link: string;
  sentTo: string | null;
  sentAt: string;
  firstViewedAt: string | null;
  viewCount: number;
  acceptedAt: string | null;
  acceptedName: string | null;
  /** online, phone, email, in_person or paper. */
  acceptedMethod: string | null;
  declineReason: string | null;
  /** End of the last day the customer can accept it. */
  expiresAt: string | null;
  /** Still sent or viewed, but past expiresAt (worked out on the server). */
  expired: boolean;
}

/** Everything the editor needs for sending and the sent list. */
export interface ProposalProps {
  rows: ProposalRow[];
  defaultEmail: string;
  /** From the "Sending a proposal" template, with this customer's details filled in. */
  emailDraft: { subject: string; body: string };
  acceptName: string;
  customerName: string;
  followUps: { count: number; lastAt: string | null };
  canSend: boolean;
  /** No lead linked although the customer has an open one, so accepting won't mark a lead won. */
  unlinkedLead: boolean;
  /** No job address yet: nothing can be sent or accepted until one is picked. */
  addressMissing: boolean;
  /** Surfaces in the job priced at $0, from what's on screen (the editor fills this in). */
  unpriced: UnpricedSurface[];
  /** Other estimates on the same lead the customer could still sign; accepting this one closes them. */
  otherQuotes: number[];
}

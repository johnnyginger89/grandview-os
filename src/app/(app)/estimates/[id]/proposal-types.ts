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
}

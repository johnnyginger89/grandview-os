/**
 * Server-renders the proposal parts of the estimate page with fixture rows (no database, no
 * browser): an expired proposal is flagged with its date, offers the Send dialog again and is
 * never offered for a follow-up. The flow itself is covered by tests/e2e/proposal.spec.ts.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WithSaved } from "./autosave";
import type { ProposalProps, ProposalRow } from "./proposal-types";

vi.mock("../actions", () => {
  const fail = async () => ({ ok: false, error: "not in tests" });
  return { sendProposalAction: fail, setStatusAction: fail, withdrawProposalAction: fail, acceptForCustomerAction: fail, followUpDraftAction: fail, sendFollowUpAction: fail };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }));

const { ExpiredNotice, SentProposals, proposalStatusText, validUntilText } = await import("./send-proposal");

// The end of Mar 22, 2026 in Vancouver.
const EXPIRES = "2026-03-23T06:59:59.999Z";
const row = (extra: Partial<ProposalRow> = {}): ProposalRow => ({
  id: "p1", revision: 2, status: "viewed", link: "http://localhost/share/p/AAAAAAAAAAAAAAAAAAAAbbbb", sentTo: "kim@example.com", sentAt: "2026-02-20T17:00:00.000Z",
  firstViewedAt: "2026-02-21T17:00:00.000Z", viewCount: 2, acceptedAt: null, acceptedName: null, acceptedMethod: null, declineReason: null,
  expiresAt: EXPIRES, expired: false, ...extra,
});
const props = (rows: ProposalRow[], extra: Partial<ProposalProps> = {}): ProposalProps => ({
  rows, defaultEmail: "kim@example.com", emailDraft: { subject: "Your painting proposal", body: "Hi Kim" }, acceptName: "Kim Lee",
  customerName: "[TEST DATA] Kim Lee", followUps: { count: 0, lastAt: null }, canSend: true, ...extra,
});
// React separates adjacent text with <!-- -->; drop it to read the text as shown.
const text = (html: string) => html.replace(/<!-- -->/g, "");
// Saving first isn't part of what's rendered here.
const withSaved: WithSaved = (run) => run("2026-02-20T17:00:00.000Z");
const notice = (p: ProposalProps) => text(renderToString(createElement(ExpiredNotice, { estimateId: "e1", proposals: p, withSaved })));
const sent = (p: ProposalProps) => text(renderToString(createElement(SentProposals, { estimateId: "e1", proposals: p })));

describe("estimate page: proposal validity", () => {
  it("shows how long an open proposal is valid, and offers a follow-up", () => {
    const rows = [row()];
    expect(validUntilText(rows)).toBe("valid until Mar 22, 2026");
    expect(proposalStatusText(rows)).toBe("Opened 2×");
    expect(notice(props(rows))).toBe("");
    const list = sent(props(rows));
    expect(list).toContain(">viewed</span>");
    expect(list).toContain("Valid until Mar 22, 2026");
    expect(list).toContain("Follow up");
  });

  it("flags an expired proposal with its date and offers the Send dialog again", () => {
    const rows = [row({ expired: true })];
    expect(validUntilText(rows)).toBeNull();
    expect(proposalStatusText(rows)).toBe("Expired on Mar 22, 2026");
    const flag = notice(props(rows));
    expect(flag).toContain('aria-label="Expired proposal"');
    expect(flag).toContain("Expired on Mar 22, 2026.</strong> The customer can no longer accept this proposal.");
    expect(flag).toContain("Send updated proposal");
    const list = sent(props(rows));
    expect(list).toContain(">expired</span>");
    expect(list).toContain("Expired on Mar 22, 2026");
    expect(list).not.toContain("Follow up");
    expect(list).toContain("Withdraw");
  });

  it("shows the flag without the button to logins that can't send", () => {
    const flag = notice(props([row({ expired: true })], { canSend: false }));
    expect(flag).toContain("Expired on Mar 22, 2026.");
    expect(flag).not.toContain("Send updated proposal");
  });

  it("shows no date for a draft or a proposal that's no longer open", () => {
    expect(validUntilText([])).toBeNull();
    for (const status of ["accepted", "declined", "superseded", "withdrawn"]) {
      const rows = [row({ status, acceptedAt: status === "accepted" ? "2026-02-25T17:00:00.000Z" : null, acceptedName: status === "accepted" ? "Kim Lee" : null })];
      expect(validUntilText(rows), status).toBeNull();
      expect(notice(props(rows)), status).toBe("");
      expect(sent(props(rows)), status).not.toMatch(/Valid until|Expired on/);
    }
  });
});

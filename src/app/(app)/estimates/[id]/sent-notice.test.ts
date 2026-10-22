import { describe, expect, it } from "vitest";
import type { ProposalRow } from "./proposal-types";
import { changedSinceSent } from "./sent-notice";

const SENT = "2026-10-20T17:00:00.000Z";
const row = (status: string, sentAt = SENT): ProposalRow => ({
  id: "p",
  revision: 1,
  status,
  link: "https://x/share/p/abc",
  sentTo: null,
  sentAt,
  firstViewedAt: null,
  viewCount: 0,
  acceptedAt: null,
  acceptedName: null,
  acceptedMethod: null,
  declineReason: null,
  expiresAt: null,
  expired: false,
});

describe("changed since it was sent", () => {
  it("is quiet right after sending: the estimate's version is the moment it was sent", () => {
    expect(changedSinceSent("sent", [row("sent")], { version: SENT, dirty: false })).toBeNull();
  });

  it("gives the send date once the estimate is saved with changes, or has unsaved ones", () => {
    expect(changedSinceSent("sent", [row("viewed")], { version: "2026-10-20T18:30:00.000Z", dirty: false })).toBe(SENT);
    expect(changedSinceSent("sent", [row("sent")], { version: SENT, dirty: true })).toBe(SENT);
  });

  it("uses the proposal the customer can still sign, not older ones", () => {
    const rows = [row("sent", "2026-10-21T16:00:00.000Z"), row("superseded")];
    expect(changedSinceSent("sent", rows, { version: "2026-10-21T16:00:00.000Z", dirty: false })).toBeNull();
    expect(changedSinceSent("sent", rows, { version: "2026-10-21T17:00:00.000Z", dirty: false })).toBe("2026-10-21T16:00:00.000Z");
  });

  it("allows for proposals sent before their time matched the estimate's version exactly", () => {
    expect(changedSinceSent("sent", [row("sent")], { version: "2026-10-20T17:00:00.040Z", dirty: false })).toBeNull();
  });

  it("says nothing when no proposal is waiting on the customer, or the estimate is accepted", () => {
    expect(changedSinceSent("draft", [], { version: SENT, dirty: true })).toBeNull();
    expect(changedSinceSent("declined", [row("declined")], { version: "2026-10-21T00:00:00.000Z", dirty: true })).toBeNull();
    expect(changedSinceSent("sent", [row("withdrawn")], { version: "2026-10-21T00:00:00.000Z", dirty: true })).toBeNull();
    expect(changedSinceSent("accepted", [row("sent")], { version: "2026-10-21T00:00:00.000Z", dirty: true })).toBeNull();
  });
});

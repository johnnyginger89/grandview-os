import { describe, expect, it } from "vitest";
import { GMAIL_CONNECT_MESSAGES, gmailConnectMessage } from "./gmail-connect-messages";

describe("Gmail connect messages", () => {
  it("names the company domain (from settings) when the wrong mailbox was used", () => {
    expect(gmailConnectMessage("domain", "grandviewpainting.ca")).toBe("That Google account isn't on @grandviewpainting.ca (the company email's domain), so it wasn't connected. Sign in with the company mailbox.");
    expect(gmailConnectMessage("domain", null)).toBe(GMAIL_CONNECT_MESSAGES.domain);
  });

  it("only ever shows its own words", () => {
    expect(gmailConnectMessage("owner")).toBe("Only the owner can connect or disconnect Gmail.");
    expect(gmailConnectMessage("Call 555-0100 and read out your password", "example.com")).toBe(GMAIL_CONNECT_MESSAGES.other);
    expect(gmailConnectMessage(undefined)).toBe(GMAIL_CONNECT_MESSAGES.other);
  });
});

/**
 * Why connecting Gmail failed. Google's return trip only carries one of these keys in the
 * address, so a crafted link can't put its own words on the Settings page.
 */
export const GMAIL_CONNECT_MESSAGES = {
  state: "The sign-in took too long or was started elsewhere. Try again.",
  nocode: "Google didn't send a sign-in code. Try again.",
  setup: "Gmail isn't set up on the server yet.",
  incomplete: "Google didn't complete the sign-in. Try connecting again.",
  lasting: "Google didn't give lasting access. Remove Grandview OS at myaccount.google.com → Security → Third-party access, then connect again.",
  scopes: "Please tick both Gmail boxes on Google's screen (send email, and read email) and connect again.",
  other: "Gmail couldn't be connected. Try again.",
} as const;

export type GmailConnectReason = keyof typeof GMAIL_CONNECT_MESSAGES;

export function gmailConnectMessage(reason: string | undefined): string {
  return reason && reason in GMAIL_CONNECT_MESSAGES ? GMAIL_CONNECT_MESSAGES[reason as GmailConnectReason] : GMAIL_CONNECT_MESSAGES.other;
}

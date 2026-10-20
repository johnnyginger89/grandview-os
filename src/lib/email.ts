/**
 * Outbound email. Uses Resend's HTTP API when RESEND_API_KEY is set; otherwise
 * (development) the message is printed to the server log and reported as
 * "logged" so nothing reaches real customers by accident.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface EmailResult {
  status: "sent" | "logged" | "failed";
  provider: string;
  providerMessageId?: string;
  error?: string;
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key && process.env.VERCEL_ENV === "production") {
    // Never write message bodies (which can contain reset links) to production logs.
    return { status: "failed", provider: "none", error: "Email delivery is not configured (RESEND_API_KEY missing)" };
  }
  if (!key) {
    console.info(`[email:dev] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`);
    return { status: "logged", provider: "dev-log" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        reply_to: msg.replyTo,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { status: "failed", provider: "resend", error: body.message ?? `HTTP ${res.status}` };
    return { status: "sent", provider: "resend", providerMessageId: body.id };
  } catch (e) {
    return { status: "failed", provider: "resend", error: e instanceof Error ? e.message : String(e) };
  }
}

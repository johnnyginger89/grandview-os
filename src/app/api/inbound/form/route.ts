import { NextResponse } from "next/server";
import { readFormBody, verifyWebhookSecret } from "@/server/inbound";
import { receiveWebForm } from "@/server/inbound-events";

/**
 * Website contact-form submissions. Accepts JSON or standard form posts.
 * New submissions land in "New Lead – To Contact"; ones that can't be imported
 * are kept under Leads → "Couldn't import".
 */
export async function POST(req: Request) {
  if (!verifyWebhookSecret(req, "form")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = await readFormBody(req);
  // Honeypot field: real people leave it empty.
  if (payload["website_url"] || payload["_gotcha"]) return NextResponse.json({ ok: true });

  const r = await receiveWebForm(payload);
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.unreadable ? 400 : 422 });
}

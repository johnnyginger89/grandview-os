import { NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/server/inbound";
import { receiveBooking } from "@/server/inbound-events";

/**
 * YouCanBook.me webhook. Configure a webhook notification in YouCanBook.me
 * pointing at /api/inbound/youcanbookme?key=<YCBM_WEBHOOK_SECRET> with a
 * JSON body (see docs/integrations/youcanbookme.md for the template).
 */
export async function POST(req: Request) {
  if (!verifyWebhookSecret(req, "youcanbookme")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await receiveBooking(await req.text());
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.unreadable ? 400 : 422 });
}

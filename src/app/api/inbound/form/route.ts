import { NextResponse } from "next/server";
import { finishInbound, ingestLead, recordInbound } from "@/server/leads";
import { payloadToLead, verifyWebhookSecret } from "@/server/inbound";

/**
 * Website contact-form submissions. Accepts JSON or standard form posts.
 * New submissions land in "New Lead – To Contact".
 */
export async function POST(req: Request) {
  if (!verifyWebhookSecret(req, "form")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let payload: Record<string, unknown>;
  const type = req.headers.get("content-type") ?? "";
  try {
    payload = type.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  // Honeypot field: real people leave it empty.
  if (payload["website_url"] || payload["_gotcha"]) return NextResponse.json({ ok: true });

  const lead = payloadToLead(payload);
  if (!lead.email && !lead.phone) return NextResponse.json({ error: "email or phone required" }, { status: 422 });
  const inbound = await recordInbound("website_form", null, payload);
  try {
    const result = await ingestLead(lead, { stageKey: "new_lead", channel: "website_form", externalSource: "website_form" });
    await finishInbound(inbound.id, { opportunityId: result.opportunityId });
    return NextResponse.json({ ok: true, opportunityId: result.opportunityId });
  } catch (e) {
    await finishInbound(inbound.id, { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "could not process submission" }, { status: 422 });
  }
}

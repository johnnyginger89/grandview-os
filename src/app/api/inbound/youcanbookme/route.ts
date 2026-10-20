import { NextResponse } from "next/server";
import { finishInbound, ingestLead, moveStage, recordInbound, stageByKey } from "@/server/leads";
import { payloadToLead, pick, verifyWebhookSecret } from "@/server/inbound";
import { db } from "@/db";

/**
 * YouCanBook.me webhook. Configure a webhook notification in YouCanBook.me
 * pointing at /api/inbound/youcanbookme?key=<YCBM_WEBHOOK_SECRET> with a
 * JSON body (see docs/integrations/youcanbookme.md for the template).
 */
export async function POST(req: Request) {
  if (!verifyWebhookSecret(req, "youcanbookme")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const lead = payloadToLead(payload);
  const event = (pick(payload, "event", "action", "type") ?? "booked").toLowerCase();
  const ref = lead.bookingRef ? String(lead.bookingRef) : null;
  // A booking can be rescheduled many times; include the new time so each change is processed once.
  const dedupeKey = ref ? [ref, event, event.includes("resched") ? (lead.visitAt ?? "") : ""].join(":") : null;
  const inbound = await recordInbound("youcanbookme", dedupeKey, payload);
  if (inbound.duplicate) return NextResponse.json({ ok: true, duplicate: true, opportunityId: inbound.opportunityId });

  try {
    if (event.includes("cancel")) {
      const opp = ref
        ? await db.query.opportunities.findFirst({ where: (t, { and, eq }) => and(eq(t.externalSource, "youcanbookme"), eq(t.externalRef, ref)) })
        : undefined;
      if (opp) {
        const lost = await stageByKey("lost");
        await moveStage(opp.id, lost.id, null, "Booking cancelled");
      }
      await finishInbound(inbound.id, { opportunityId: opp?.id });
      return NextResponse.json({ ok: true, cancelled: !!opp });
    }
    const result = await ingestLead(lead, { stageKey: "estimate_booked", channel: "youcanbookme", externalSource: "youcanbookme", externalRef: ref });
    await finishInbound(inbound.id, { opportunityId: result.opportunityId });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishInbound(inbound.id, { error: message });
    return NextResponse.json({ error: "could not process booking" }, { status: 422 });
  }
}

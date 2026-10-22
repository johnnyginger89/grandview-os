import type { NextRequest } from "next/server";
import { isCronCaller } from "@/lib/cron-auth";
import { syncGmail } from "@/server/integrations/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Catching up on 60 days of mail can take a while.
export const maxDuration = 300;

/** Every 10 minutes (Vercel Cron): copy new customer emails from Gmail into their files. */
export async function GET(req: NextRequest) {
  if (!isCronCaller(req)) return Response.json({ error: "Not allowed." }, { status: 401 });
  try {
    return Response.json(await syncGmail(new Date()), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[gmail] sync failed", e instanceof Error ? e.message : e);
    return Response.json({ ran: false, error: "sync failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

import type { NextRequest } from "next/server";
import { isCronCaller } from "@/lib/cron-auth";
import { sendDailyUpdateReminders } from "@/server/job-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Cron calls this at 23:00 UTC (4 pm in summer) and ./winter at 00:00 UTC (4 pm
 * in winter); only the call that lands in the 4 pm hour in Vancouver does anything, once
 * a day. On the Hobby plan a call can come up to 59 minutes late, still within that hour.
 * Callers are checked by isCronCaller.
 */
export async function GET(req: NextRequest) {
  if (!isCronCaller(req)) return Response.json({ error: "Not allowed." }, { status: 401 });
  const result = await sendDailyUpdateReminders(new Date());
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

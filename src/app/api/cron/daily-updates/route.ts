import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendDailyUpdateReminders } from "@/server/job-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Cron calls this at 23:00 UTC (4 pm in summer) and ./winter at 00:00 UTC (4 pm
 * in winter); only the call that lands in the 4 pm hour in Vancouver does anything, once
 * a day. On the Hobby plan a call can come up to 59 minutes late, still within that hour. With CRON_SECRET set,
 * Vercel sends it as a bearer token and nothing else gets in. Without it, only Vercel's
 * cron caller is accepted, and the worst a stranger could do is send the 4 pm reminder
 * at 4 pm.
 */
function allowed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = Buffer.from(req.headers.get("authorization") ?? "");
    const want = Buffer.from(`Bearer ${secret}`);
    return got.length === want.length && timingSafeEqual(got, want);
  }
  return (req.headers.get("user-agent") ?? "").startsWith("vercel-cron/");
}

export async function GET(req: NextRequest) {
  if (!allowed(req)) return Response.json({ error: "Not allowed." }, { status: 401 });
  const result = await sendDailyUpdateReminders(new Date());
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

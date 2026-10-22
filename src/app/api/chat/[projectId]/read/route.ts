import type { NextRequest } from "next/server";
import { getCurrentUser, needsAccountSetup } from "@/lib/authz/guard";
import { isSameOrigin } from "@/lib/same-origin";
import { markChannelRead } from "@/server/job-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  if (!isSameOrigin(req)) return Response.json({ error: "Not allowed." }, { status: 403 });
  const user = await getCurrentUser();
  if (!user || needsAccountSetup(user)) return Response.json({ error: "Please sign in again." }, { status: 401 });
  await markChannelRead(user, (await ctx.params).projectId);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, needsMfaEnrollment } from "@/lib/authz/guard";
import { safeErrorMessage } from "@/lib/action-error";
import { isSameOrigin } from "@/lib/same-origin";
import { ChatError, listMessages, markChannelRead, postMessage } from "@/server/job-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const querySchema = z.object({
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
  read: z.enum(["1"]).optional(),
});

async function viewer() {
  const user = await getCurrentUser();
  return user && !needsMfaEnrollment(user) ? user : null;
}

/** A page of the job's chat (newest last), or what's new since `after`. `read=1` marks it read. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  const user = await viewer();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401, headers: NO_STORE });
  const { projectId } = await ctx.params;
  const q = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return Response.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const page = await listMessages(user, projectId, { after: q.data.after ? new Date(q.data.after) : null, before: q.data.before ? new Date(q.data.before) : null });
  if (!page) return Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  if (q.data.read) await markChannelRead(user, projectId);
  return Response.json(page, { headers: NO_STORE });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  if (!isSameOrigin(req)) return Response.json({ error: "Not allowed." }, { status: 403, headers: NO_STORE });
  const user = await viewer();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401, headers: NO_STORE });
  const { projectId } = await ctx.params;
  try {
    const message = await postMessage(user, projectId, await req.json().catch(() => null));
    return Response.json({ message }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: e.issues[0]?.message ?? "Check the message." }, { status: 400, headers: NO_STORE });
    const status = e instanceof ChatError ? 400 : 500;
    if (status === 500) console.error("[chat] post failed", e instanceof Error ? e.message : e);
    return Response.json({ error: safeErrorMessage(e) }, { status, headers: NO_STORE });
  }
}

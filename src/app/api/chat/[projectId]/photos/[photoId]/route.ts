import type { NextRequest } from "next/server";
import { getCurrentUser, needsMfaEnrollment } from "@/lib/authz/guard";
import { photoFile } from "@/server/job-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/** A job photo, only for people in that job's chat. Private cache: never stored by shared caches. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ projectId: string; photoId: string }> }) {
  const user = await getCurrentUser();
  if (!user || needsMfaEnrollment(user)) return notFound();
  const { projectId, photoId } = await ctx.params;
  const variant = req.nextUrl.searchParams.get("size") === "thumb" ? "thumb" : "full";
  const file = await photoFile(user, projectId, photoId, variant);
  if (!file) return notFound();
  const etag = `"${file.sha256}-${variant}"`;
  const headers = {
    "Content-Type": file.contentType,
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(file.data), { status: 200, headers: { ...headers, "Content-Length": String(file.data.length) } });
}

import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { media } from "@/db/schema";
import { getCurrentUser, needsAccountSetup } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { documentHeaders, downloadName } from "@/server/media-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/**
 * Uploaded media. Images are public (random v4 ids; rows are immutable, so cached forever).
 * Documents need a staff session; anyone else gets 404, never 403.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return notFound();
  const meta = await db.query.media.findFirst({
    where: and(eq(media.id, id), eq(media.status, "ready")),
    columns: { id: true, kind: true, purpose: true, contentType: true, sha256: true, originalFilename: true, title: true },
  });
  if (!meta) return notFound();

  if (meta.kind === "document") {
    const user = await getCurrentUser();
    if (!user || needsAccountSetup(user) || !(can(user.role, "settings.manage") || can(user.role, "estimates.read"))) return notFound();
  }

  const etag = `"${meta.sha256}"`;
  const baseHeaders: Record<string, string> =
    meta.kind === "image"
      ? {
          "Content-Type": meta.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
          ETag: etag,
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `inline; filename="${meta.originalFilename}"`,
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cross-Origin-Resource-Policy": "same-origin",
        }
      : { ...documentHeaders(meta.contentType, downloadName(meta.purpose, meta.contentType, meta.title)), "Cache-Control": "private, no-store", ETag: etag };

  if (meta.kind === "image" && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: baseHeaders });

  const row = await db.query.media.findFirst({ where: eq(media.id, id), columns: { data: true } });
  if (!row) return notFound();
  return new Response(new Uint8Array(row.data), { status: 200, headers: { ...baseHeaders, "Content-Length": String(row.data.length) } });
}

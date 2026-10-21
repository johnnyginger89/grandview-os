import type { NextRequest } from "next/server";
import { verifyImageLink } from "@/server/integrations/companycam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/**
 * A CompanyCam photo, fetched by our server. Only URLs this server signed (from
 * CompanyCam's own API answer, for a day) are fetched, so this can't be used to reach
 * anything else.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const url = verifyImageLink({ u: p.get("u"), e: p.get("e"), s: p.get("s") });
  if (!url) return notFound();
  let upstream: Response;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch {
    return new Response("CompanyCam isn't answering", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const type = upstream.headers.get("content-type") ?? "";
  const length = Number(upstream.headers.get("content-length") ?? "0");
  if (!upstream.ok || !/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(type.split(";")[0].trim()) || length > MAX_BYTES || !upstream.body) return notFound();
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": type,
      ...(length ? { "Content-Length": String(length) } : {}),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

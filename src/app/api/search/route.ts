import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, needsAccountSetup } from "@/lib/authz/guard";
import { MAX_QUERY_LENGTH } from "@/lib/search/query";
import { canSearch, globalSearch } from "@/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ q: z.string().max(MAX_QUERY_LENGTH * 4).default("") });
const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** The search box in the top bar. Signed-in office staff only; results never include money. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || needsAccountSetup(user)) return Response.json({ error: "Please sign in again." }, { status: 401, headers: NO_STORE });
  if (!canSearch(user.role)) return Response.json({ error: "Search isn't available for your account." }, { status: 403, headers: NO_STORE });
  const parsed = querySchema.safeParse({ q: req.nextUrl.searchParams.get("q") ?? undefined });
  if (!parsed.success) return Response.json({ error: "That search is too long." }, { status: 400, headers: NO_STORE });
  try {
    return Response.json(await globalSearch(user, parsed.data.q), { headers: NO_STORE });
  } catch (e) {
    console.error("[search] failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Search isn't working right now. Please try again." }, { status: 500, headers: NO_STORE });
  }
}

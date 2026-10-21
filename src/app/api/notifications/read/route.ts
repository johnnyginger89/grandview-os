import { z } from "zod";
import { getCurrentUser, needsMfaEnrollment } from "@/lib/authz/guard";
import { markRead } from "@/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().uuid()).min(1).max(100) })]);
const NO_STORE = { "Cache-Control": "private, no-store" };

/** Marks the signed-in person's own notices read. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || needsMfaEnrollment(user)) return Response.json({ error: "Please sign in again." }, { status: 401, headers: NO_STORE });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Nothing to mark." }, { status: 400, headers: NO_STORE });
  await markRead(user.id, "all" in parsed.data ? "all" : parsed.data.ids);
  return Response.json({ ok: true }, { headers: NO_STORE });
}

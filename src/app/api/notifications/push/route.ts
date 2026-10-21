import { z } from "zod";
import { getCurrentUser, needsMfaEnrollment } from "@/lib/authz/guard";
import { deletePushSubscription, savePushSubscription } from "@/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Saves this device so notices reach it as phone or desktop notifications. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || needsMfaEnrollment(user)) return Response.json({ error: "Please sign in again." }, { status: 401, headers: NO_STORE });
  try {
    await savePushSubscription(user.id, await req.json(), req.headers.get("user-agent"));
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "This device couldn't be set up for notifications." }, { status: 400, headers: NO_STORE });
  }
}

/** Stops notifications to this device. */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user || needsMfaEnrollment(user)) return Response.json({ error: "Please sign in again." }, { status: 401, headers: NO_STORE });
  const parsed = z.object({ endpoint: z.string().url().max(2000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown device." }, { status: 400, headers: NO_STORE });
  await deletePushSubscription(user.id, parsed.data.endpoint);
  return Response.json({ ok: true }, { headers: NO_STORE });
}

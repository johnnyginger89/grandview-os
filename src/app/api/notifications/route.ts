import { getCurrentUser, needsAccountSetup } from "@/lib/authz/guard";
import { listNotifications, vapidPublicKey } from "@/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** The signed-in person's recent notices, unread count and the key their browser needs to subscribe to pushes. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || needsAccountSetup(user)) return Response.json({ error: "Please sign in again." }, { status: 401, headers: NO_STORE });
  const [list, key] = await Promise.all([listNotifications(user.id), vapidPublicKey()]);
  return Response.json({ ...list, vapidPublicKey: key }, { headers: NO_STORE });
}

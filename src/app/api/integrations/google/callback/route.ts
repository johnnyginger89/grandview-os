import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, needsAccountSetup } from "@/lib/authz/guard";
import { can, canConnectMailbox } from "@/lib/authz/permissions";
import { GMAIL_CONNECT_MESSAGES, type GmailConnectReason } from "@/lib/gmail-connect-messages";
import { completeGmailConnection, GmailError } from "@/server/integrations/gmail";
import { requestMeta } from "@/server/request-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gv_google_state";

/** Google sends the owner back here: check it's the same sign-in we started, then keep the connection. */
export async function GET(req: NextRequest) {
  const back = (result: string, reason?: GmailConnectReason) => {
    const url = new URL("/settings", req.url);
    url.searchParams.set("tab", "integrations");
    url.searchParams.set("gmail", result);
    if (reason) url.searchParams.set("reason", reason);
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/integrations/google" });
    return res;
  };
  const user = await getCurrentUser();
  if (!user || needsAccountSetup(user) || !can(user.role, "settings.manage")) return NextResponse.redirect(new URL("/no-access", req.url));
  if (!canConnectMailbox(user.role)) return back("error", "owner");
  const p = req.nextUrl.searchParams;
  const want = Buffer.from(req.cookies.get(STATE_COOKIE)?.value ?? "");
  const got = Buffer.from(p.get("state") ?? "");
  if (!want.length || want.length !== got.length || !timingSafeEqual(want, got)) return back("error", "state");
  if (p.get("error")) return back("denied");
  const code = p.get("code");
  if (!code) return back("error", "nocode");
  try {
    await completeGmailConnection(code, user, requestMeta(req.headers));
    return back("connected");
  } catch (e) {
    const known = e instanceof GmailError ? (Object.entries(GMAIL_CONNECT_MESSAGES).find(([, m]) => m === e.message)?.[0] as GmailConnectReason | undefined) : undefined;
    return back("error", known ?? "other");
  }
}

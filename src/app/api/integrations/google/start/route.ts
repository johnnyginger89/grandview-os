import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, needsAccountSetup } from "@/lib/authz/guard";
import { can, canConnectMailbox } from "@/lib/authz/permissions";
import { emailDomain, googleAuthUrl } from "@/server/integrations/gmail";
import { getCompany } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gv_google_state";

/** Settings → Integrations → Connect Gmail (owner only): off to Google's sign-in, with a one-time state check. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || needsAccountSetup(user) || !can(user.role, "settings.manage")) return NextResponse.redirect(new URL("/no-access", req.url));
  if (!canConnectMailbox(user.role)) return NextResponse.redirect(new URL("/settings?tab=integrations&gmail=error&reason=owner", req.url));
  const companyEmail = (await getCompany()).email;
  if (!emailDomain(companyEmail)) return NextResponse.redirect(new URL("/settings?tab=integrations&gmail=error&reason=nodomain", req.url));
  const state = randomBytes(24).toString("base64url");
  let url: string;
  try {
    url = googleAuthUrl(state, companyEmail);
  } catch {
    return NextResponse.redirect(new URL("/settings?tab=integrations&gmail=not_configured", req.url));
  }
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/integrations/google", maxAge: 600 });
  return res;
}

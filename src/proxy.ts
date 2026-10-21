import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Fast redirect for signed-out visitors. This is a convenience only:
// every page and server action re-checks the session and permissions.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|login|setup|share|_next/static|_next/image|favicon.ico|icon|apple-icon|brand|proposal|manifest|sw\\.js).*)"],
};

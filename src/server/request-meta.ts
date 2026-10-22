import "server-only";
import { getIP } from "better-auth/api";
import { auth } from "@/lib/auth";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Where a request came from, for audit entries: the client IP as the sign-in limits see it
 * (Vercel's own forwarded header first, so it can't be made up by the browser) and the browser.
 */
export function requestMeta(h: Headers): RequestMeta {
  let ip: string | null = null;
  try {
    ip = getIP(h, auth.options);
  } catch {
    ip = null;
  }
  const userAgent = (h.get("user-agent") ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 300);
  return { ip: ip ? ip.slice(0, 64) : null, userAgent: userAgent || null };
}

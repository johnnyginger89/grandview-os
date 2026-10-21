/**
 * For JSON and upload routes that change data: the request must come from our own pages.
 * Session cookies are SameSite=Lax already; this also refuses a cross-site fetch outright.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

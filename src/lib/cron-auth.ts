import { timingSafeEqual } from "node:crypto";

/**
 * Who may call a cron route: with CRON_SECRET set, Vercel sends it as a bearer token and
 * nothing else gets in. Without it, only Vercel's cron caller is accepted; cron routes do
 * only what their schedule would do anyway.
 */
export function isCronCaller(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = Buffer.from(req.headers.get("authorization") ?? "");
    const want = Buffer.from(`Bearer ${secret}`);
    return got.length === want.length && timingSafeEqual(got, want);
  }
  return (req.headers.get("user-agent") ?? "").startsWith("vercel-cron/");
}

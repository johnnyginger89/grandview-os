// The same check at 00:00 UTC, which is 4 pm in Vancouver in winter (PST). Vercel's
// Hobby plan allows each cron job to run only once a day, hence two jobs.
export { GET } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

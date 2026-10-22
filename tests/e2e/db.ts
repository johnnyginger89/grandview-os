import { Client } from "pg";

/** Specs that move dates need the database of the server under test (the DATABASE_URL it was started with). */
export const NEEDS_DATABASE = "Set DATABASE_URL to the test server's database to run this spec";
export const hasDatabase = () => !!process.env.DATABASE_URL;

/**
 * Moves a proposal created by the test into the past, since nothing in the app can make time
 * pass: `sentDaysAgo` backdates when it was sent, `expired` ends its validity yesterday.
 */
export async function backdateProposal(link: string, change: { sentDaysAgo?: number; expired?: boolean }) {
  const token = new URL(link).pathname.split("/").pop();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query(
      `update proposals
          set sent_at = coalesce(now() - make_interval(days => $2::int), sent_at),
              expires_at = case when $3::boolean then now() - interval '1 day' else expires_at end
        where token = $1`,
      [token, change.sentDaysAgo ?? null, change.expired ?? false],
    );
    if (r.rowCount !== 1) throw new Error(`Proposal ${token} not found: is DATABASE_URL the test server's database?`);
  } finally {
    await client.end();
  }
}

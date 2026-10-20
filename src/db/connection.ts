/** Connection settings shared by the app, migrations and scripts. */
export function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  } catch {
    return false;
  }
}

export function databaseUrl(): string {
  // A placeholder keeps `next build` working without credentials; the
  // instrumentation hook refuses to start production without a real URL.
  return process.env.DATABASE_URL ?? "postgres://unset@localhost:5432/unset";
}

/**
 * postgres.js options for Supabase's Supavisor session pooler (port 5432),
 * which Vercel can reach over IPv4. Session mode supports prepared statements
 * and pipelining safely; prepare stays off so switching to the transaction
 * pooler later is still safe.
 */
export function connectionOptions(url: string, overrides: { max?: number } = {}) {
  const local = isLocalDatabase(url);
  return {
    max: overrides.max ?? Number(process.env.DB_POOL_MAX ?? (local ? 10 : 3)),
    prepare: false,
    ssl: local ? (false as const) : ("require" as const),
    idle_timeout: local ? undefined : 5,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
  };
}

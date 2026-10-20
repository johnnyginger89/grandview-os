/** Connection settings shared by the app, migrations and scripts. */
export function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  } catch {
    return false;
  }
}

/**
 * The database URL to use. Supabase pooler URLs are moved to transaction mode
 * (port 6543): serverless instances are frozen without closing sockets, and in
 * session mode (5432) each frozen socket keeps a pooler slot until the small
 * free-tier pool is exhausted. Transaction mode only holds a slot per query.
 * sslmode is stripped because SSL is configured explicitly below.
 */
export function databaseUrl(raw = process.env.DATABASE_URL): string {
  // A placeholder keeps `next build` working without credentials; the
  // instrumentation hook refuses to start production without a real URL.
  if (!raw) return "postgres://unset@localhost:5432/unset";
  try {
    const u = new URL(raw);
    if (u.hostname.endsWith(".pooler.supabase.com") && u.port === "5432") u.port = "6543";
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return raw;
  }
}

/** node-postgres pool options. */
export function poolConfig(url: string, overrides: { max?: number } = {}) {
  const local = isLocalDatabase(url);
  return {
    connectionString: url,
    max: overrides.max ?? Number(process.env.DB_POOL_MAX ?? (local ? 10 : 5)),
    // Encrypted; Supabase's certificate is signed by its own CA, so it isn't verified here.
    ssl: local ? false : { rejectUnauthorized: false },
    idleTimeoutMillis: local ? 30_000 : 5_000,
    connectionTimeoutMillis: 10_000,
    maxLifetimeSeconds: 60 * 30,
  };
}

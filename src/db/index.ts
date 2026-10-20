import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseUrl, poolConfig } from "./connection";
import * as schema from "./schema";

const url = databaseUrl();

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pgPool?: Pool };
const pool = globalForDb.pgPool ?? new Pool(poolConfig(url));
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;
// Lets Vercel close idle connections before an instance is suspended.
if (process.env.VERCEL) attachDatabasePool(pool);
pool.on("error", (e) => console.error("[db] idle client error", e.message));

export const db = drizzle(pool, { schema, casing: "snake_case" });
export type DB = typeof db;
export { schema };

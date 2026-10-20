import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { connectionOptions, databaseUrl } from "./connection";
import * as schema from "./schema";

const url = databaseUrl();

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
const client = globalForDb.pg ?? postgres(url, connectionOptions(url));
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export type DB = typeof db;
export { schema };

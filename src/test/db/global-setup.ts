/**
 * Global setup for `pnpm test:db` (vitest.db.config.mts). Runs once per run, before any
 * test file: recreates the throwaway test database, applies the migrations and the
 * baseline seed exactly as a deploy does, and hands the database's URL to the test files.
 * The database is dropped again when the run ends.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import type { TestProject } from "vitest/node";
import { poolConfig } from "@/db/connection";

const DEFAULT_TEST_DATABASE_URL = "postgres://postgres@localhost:5432/grandview_dbtest";

declare module "vitest" {
  export interface ProvidedContext {
    /** The test database, for the app's db (DATABASE_URL) in each test file. */
    databaseUrl: string;
  }
}

/** The test database's name and URLs. Refuses any name that doesn't start with grandview_dbtest: it gets dropped. */
function testDatabase(raw: string) {
  const url = new URL(raw);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^grandview_dbtest[a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to use "${name}" for database tests: the test database is dropped on every run, so its name must start with grandview_dbtest.`);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return { name, url: url.toString(), adminUrl: admin.toString() };
}

async function onServer(adminUrl: string, statement: string) {
  const { connectionString, ssl } = poolConfig(adminUrl);
  const client = new Client({ connectionString, ssl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject) {
  const test = testDatabase(process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL);
  const drop = () => onServer(test.adminUrl, `drop database if exists "${test.name}" with (force)`);
  await drop();
  await onServer(test.adminUrl, `create database "${test.name}"`);
  try {
    const pool = new Pool(poolConfig(test.url, { max: 1 }));
    try {
      await migrate(drizzle(pool), { migrationsFolder: path.join(project.config.root, "drizzle") });
    } finally {
      await pool.end();
    }
    // The seed uses the app's db, which reads DATABASE_URL when first imported.
    process.env.DATABASE_URL = test.url;
    const { db } = await import("@/db");
    const { seedBaseline } = await import("@/db/seed");
    try {
      await seedBaseline();
    } finally {
      await db.$client.end();
    }
  } catch (e) {
    // Vitest skips the teardown when setup fails: don't leave a half-built database on the server.
    await drop();
    throw e;
  }

  project.provide("databaseUrl", test.url);
  return drop;
}

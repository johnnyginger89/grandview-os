/**
 * Runs in the test worker before each *.db.test.ts file (vitest.db.config.mts): points
 * the app's db at the test database before anything imports it, and closes it afterwards.
 */
import { afterAll, inject, vi } from "vitest";

vi.mock("server-only", () => ({}));

process.env.DATABASE_URL = inject("databaseUrl");

afterAll(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});

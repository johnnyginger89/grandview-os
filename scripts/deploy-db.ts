/**
 * Runs during the Vercel build: applies pending migrations, then the idempotent
 * baseline seed. Only on production builds, so preview builds can never touch
 * the production database.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { connectionOptions } from "../src/db/connection";

async function main() {
  const onVercel = !!process.env.VERCEL;
  if (onVercel && process.env.VERCEL_ENV !== "production") {
    console.log(`[deploy-db] ${process.env.VERCEL_ENV} build: skipping migrations.`);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("[deploy-db] DATABASE_URL is not set for this build.");
  const host = new URL(url).hostname;
  console.log(`[deploy-db] migrating database on ${host}`);
  const client = postgres(url, { ...connectionOptions(url, { max: 1 }), onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    console.log("[deploy-db] migrations applied");
  } finally {
    await client.end({ timeout: 5 });
  }
  const { seedBaseline } = await import("../src/db/seed");
  await seedBaseline();
  console.log("[deploy-db] baseline configuration seeded");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

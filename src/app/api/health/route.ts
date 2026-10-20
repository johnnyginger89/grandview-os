import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/** Uptime check: no auth, no secrets, no error details. */
export async function GET() {
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    return NextResponse.json({ ok: true, db: "up", version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[health] database check failed", e);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

import "server-only";
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AttemptRule {
  /** What is being guessed. Tries with the same key run one at a time. */
  key: string;
  /** Audit actions that count as a wrong try. */
  failures: readonly string[];
  /** Count only this person's wrong tries; null counts everyone's. */
  actorId: string | null;
  max: number;
  windowMs: number;
}

export type AttemptOutcome<T> = { status: "busy" } | { status: "limited" } | { status: "ran"; value: T };

/**
 * Runs one try at a code so the "too many wrong codes" limit holds even when tries arrive at
 * the same moment. A transaction-scoped Postgres advisory lock lets one try per key run at a
 * time: it counts the recent wrong tries in audit_log, then runs `attempt`, which records a
 * wrong try in the same transaction before the lock is let go. A try that arrives while another
 * is running is turned away without being checked ("busy") instead of waiting, so queued
 * requests never hold database connections.
 */
export async function limitedAttempt<T>(rule: AttemptRule, now: Date, attempt: (tx: Tx) => Promise<T>): Promise<AttemptOutcome<T>> {
  return db.transaction(async (tx): Promise<AttemptOutcome<T>> => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${`grandview-os:${rule.key}`})) as locked`);
    if ((lock as { rows?: { locked?: unknown }[] }).rows?.[0]?.locked !== true) return { status: "busy" };
    const since = new Date(now.getTime() - rule.windowMs);
    const [{ n }] = await tx
      .select({ n: count() })
      .from(auditLog)
      .where(and(inArray(auditLog.action, [...rule.failures]), gte(auditLog.createdAt, since), rule.actorId ? eq(auditLog.actorId, rule.actorId) : undefined));
    if (n >= rule.max) return { status: "limited" };
    return { status: "ran", value: await attempt(tx) };
  });
}

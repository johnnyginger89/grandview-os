import "server-only";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function audit(
  entry: { actorId: string | null; action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown; ipAddress?: string | null },
  tx: Tx | typeof db = db,
) {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}

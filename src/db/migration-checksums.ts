import { createHash } from "node:crypto";

/** In drizzle/: one checksum per migration, written once when it is generated. */
export const CHECKSUMS_FILE = "migration-checksums.json";

/** Line endings don't count as a change. */
export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

/**
 * Records a checksum for every migration that doesn't have one yet
 * (drizzle/migration-checksums.json). Existing entries are never updated, so
 * src/server/architecture.test.ts can catch an applied migration being edited.
 * Runs after `pnpm db:generate`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHECKSUMS_FILE, migrationChecksum } from "../src/db/migration-checksums";

const drizzle = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(readFileSync(path.join(drizzle, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
const file = path.join(drizzle, CHECKSUMS_FILE);
let recorded: Record<string, string> = {};
try {
  recorded = JSON.parse(readFileSync(file, "utf8"));
} catch {
  // First run: start the file.
}

const added: string[] = [];
for (const { tag } of journal.entries) {
  if (recorded[tag]) continue;
  recorded[tag] = migrationChecksum(readFileSync(path.join(drizzle, `${tag}.sql`), "utf8"));
  added.push(tag);
}
writeFileSync(file, JSON.stringify(recorded, null, 2) + "\n");
console.log(added.length ? `[checksums] recorded ${added.join(", ")}` : "[checksums] nothing new");

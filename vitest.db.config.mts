/**
 * Database tests: the services' real SQL against a throwaway Postgres database.
 *
 *   pnpm test:db
 *
 * Needs a running Postgres. Uses TEST_DATABASE_URL, or by default
 * postgres://postgres@localhost:5432/grandview_dbtest. That database is dropped and
 * recreated at the start of every run (so its name must start with grandview_dbtest),
 * gets every migration in drizzle/ and the baseline seed, and is dropped at the end.
 * Only the *.db.test.ts files under src/ run here; `pnpm test` skips them and needs no database.
 * Files run one at a time and share the database, so each creates its own rows.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.db.test.ts"],
    environment: "node",
    globalSetup: ["src/test/db/global-setup.ts"],
    setupFiles: ["src/test/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

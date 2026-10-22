import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // *.db.test.ts need a database: they run with `pnpm test:db` (vitest.db.config.mts).
  test: { include: ["src/**/*.test.ts"], exclude: [...configDefaults.exclude, "src/**/*.db.test.ts"], environment: "node" },
});

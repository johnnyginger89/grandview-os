import { describe, expect, it } from "vitest";
import { checkEnv } from "./env";

const good = {
  VERCEL_ENV: "production",
  DATABASE_URL: "postgresql://postgres.ref:pw@aws-0-ca-central-1.pooler.supabase.com:5432/postgres",
  BETTER_AUTH_SECRET: "s".repeat(44),
  BETTER_AUTH_URL: "https://os.grandviewpainting.ca",
  YCBM_WEBHOOK_SECRET: "y".repeat(40),
  FORM_WEBHOOK_SECRET: "f".repeat(40),
  RESEND_API_KEY: "re_x",
} as unknown as NodeJS.ProcessEnv;

describe("production configuration check", () => {
  it("passes a complete production config", () => {
    expect(checkEnv(good).ok).toBe(true);
  });
  it("refuses weak or missing secrets in production", () => {
    const r = checkEnv({ ...good, BETTER_AUTH_SECRET: "short", YCBM_WEBHOOK_SECRET: undefined } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/BETTER_AUTH_SECRET/);
    expect(r.errors.join(" ")).toMatch(/YCBM_WEBHOOK_SECRET/);
  });
  it("refuses http auth URLs and dev mode in production", () => {
    expect(checkEnv({ ...good, BETTER_AUTH_URL: "http://example.com" } as NodeJS.ProcessEnv).ok).toBe(false);
    expect(checkEnv({ ...good, ALLOW_DEV_MODE: "1" } as NodeJS.ProcessEnv).ok).toBe(false);
  });
  it("warns when the scheduled jobs have no secret", () => {
    expect(checkEnv(good).warnings.join(" ")).toMatch(/CRON_SECRET/);
    expect(checkEnv({ ...good, CRON_SECRET: "c".repeat(48) } as NodeJS.ProcessEnv).warnings.join(" ")).not.toMatch(/CRON_SECRET/);
  });
  it("only warns outside production", () => {
    const r = checkEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

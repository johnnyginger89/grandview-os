import { z } from "zod";

/** True only on the live Vercel production deployment. */
export const isLiveProduction = () => process.env.VERCEL_ENV === "production";

const secret = (name: string, min: number) =>
  z.string({ error: `${name} is required` }).min(min, `${name} must be at least ${min} characters (generate with: openssl rand -base64 32)`);

const productionSchema = z.object({
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must be a postgres:// connection string"),
  BETTER_AUTH_SECRET: secret("BETTER_AUTH_SECRET", 32),
  BETTER_AUTH_URL: z.string({ error: "BETTER_AUTH_URL is required" }).url().startsWith("https://", "BETTER_AUTH_URL must use https"),
  YCBM_WEBHOOK_SECRET: secret("YCBM_WEBHOOK_SECRET", 32),
  FORM_WEBHOOK_SECRET: secret("FORM_WEBHOOK_SECRET", 32),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

export interface EnvReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const live = env.VERCEL_ENV === "production";
  const r = productionSchema.safeParse(env);
  if (!r.success) for (const i of r.error.issues) (live ? errors : warnings).push(i.message);
  if (live && env.MFA_ENFORCED === "false") warnings.push("MFA_ENFORCED=false is ignored in production; two-factor stays mandatory.");
  if (live && env.ALLOW_DEV_MODE) errors.push("ALLOW_DEV_MODE must not be set in production.");
  if (!env.RESEND_API_KEY) (live ? warnings : []).push("RESEND_API_KEY is not set: password-reset and booking-link emails will not be delivered.");
  if (env.SETUP_TOKEN && env.SETUP_TOKEN.length < 32) (live ? errors : warnings).push("SETUP_TOKEN must be at least 32 characters.");
  return { ok: errors.length === 0, errors, warnings };
}

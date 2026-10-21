import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";

/*
 * Encrypts secrets we keep in the database (integration tokens), so a database copy
 * alone doesn't give them away. AES-256-GCM with a key derived (HKDF) from
 * INTEGRATIONS_ENCRYPTION_KEY, else BETTER_AUTH_SECRET. Changing that secret makes stored
 * tokens unreadable: they then have to be entered again in Settings → Integrations.
 */

export const sealedSchema = z.object({ v: z.literal(1), iv: z.string(), tag: z.string(), data: z.string() });
export type Sealed = z.infer<typeof sealedSchema>;

function key(): Buffer {
  const base = process.env.INTEGRATIONS_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
  if (!base || base.length < 16) throw new Error("No encryption key is configured (BETTER_AUTH_SECRET).");
  return Buffer.from(hkdfSync("sha256", base, "grandview-os", "integration-secrets-v1", 32));
}

export function seal(plain: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

/** The secret, or null when it's missing, tampered with or sealed under another key. */
export function unseal(value: unknown): string | null {
  const parsed = sealedSchema.safeParse(value);
  if (!parsed.success) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(parsed.data.iv, "base64"));
    decipher.setAuthTag(Buffer.from(parsed.data.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parsed.data.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

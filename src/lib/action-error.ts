import { z } from "zod";

/**
 * Turn any thrown value into a message that is safe to show a user.
 * Validation errors and errors we throw deliberately (plain Error and its
 * named app subclasses) keep their message; anything else — database,
 * network or library errors — is logged and replaced with a generic message.
 */

export function safeErrorMessage(e: unknown): string {
  if (e instanceof z.ZodError) {
    const i = e.issues[0];
    const path = i?.path.join(".");
    return path ? `${path}: ${i?.message}` : (i?.message ?? "Please check the form");
  }
  // Class names can be minified, so app errors opt in with `expose = true`.
  if (e instanceof Error && !("code" in e) && (e.constructor === Error || (e as { expose?: boolean }).expose === true)) {
    return e.message;
  }
  console.error("[action-error]", e);
  return "Something went wrong. Please try again, and contact the office if it keeps happening.";
}

export const actionError = (e: unknown) => ({ ok: false as const, error: safeErrorMessage(e) });

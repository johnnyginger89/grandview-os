/** Share-link expiry maths and states. Pure, so the staff card and the server agree. */
import { MAX_LINK_DAYS } from "./schemas";

const DAY_MS = 86_400_000;

export type LinkStatus = "active" | "expired" | "revoked";

/** When a link created at `from` for `days` days stops working. */
export function linkExpiresAt(from: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1 || days > MAX_LINK_DAYS) throw new RangeError(`Link days must be a whole number from 1 to ${MAX_LINK_DAYS}.`);
  return new Date(from.getTime() + days * DAY_MS);
}

/** Revoked wins over expired; a link stops working at the exact expiry instant. */
export function linkStatus(link: { expiresAt: Date | string; revokedAt: Date | string | null }, now: Date): LinkStatus {
  if (link.revokedAt) return "revoked";
  return new Date(link.expiresAt).getTime() > now.getTime() ? "active" : "expired";
}

/** Whole days left before an active link expires (a part day counts as a day); 0 once expired. */
export function daysLeft(expiresAt: Date | string, now: Date): number {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / DAY_MS) : 0;
}

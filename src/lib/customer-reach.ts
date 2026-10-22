/*
 * One place for a customer's email and phone: the primary contact's. customers.email
 * and customers.phone are kept in step with them (lists, searches and older code read
 * those); a customer without a primary contact, or whose primary contact has none,
 * falls back to its own. Senders and screens read through customerReach so they agree.
 */

export interface Reach {
  email: string | null;
  phone: string | null;
}

type Details = { email?: string | null; phone?: string | null } | null | undefined;

const tidy = (s: string | null | undefined) => s?.trim() || null;
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

export function customerReach(customer: Details, primary?: Details): Reach {
  return { email: tidy(primary?.email) ?? tidy(customer?.email), phone: tidy(primary?.phone) ?? tidy(customer?.phone) };
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return (tidy(a)?.toLowerCase() ?? null) === (tidy(b)?.toLowerCase() ?? null);
}

/** Same number however it was typed ("604-555-0100" and "(604) 555 0100"). */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const [x, y] = [digits(a), digits(b)];
  return x || y ? x === y : tidy(a) === tidy(b);
}

/**
 * Where a follow-up goes when the first email went to `previous`: the same address
 * while it is still on the customer's file (another contact, say), else the customer's
 * email now, so a corrected address is picked up. Falls back to `previous`.
 */
export function followUpAddress(previous: string | null | undefined, onFile: readonly (string | null | undefined)[], current: string | null | undefined): string | null {
  const prev = tidy(previous);
  if (prev && onFile.some((e) => tidy(e) && sameEmail(e, prev))) return prev;
  return tidy(current) ?? prev;
}

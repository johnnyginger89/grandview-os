import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { businessZone } from "./time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  if (!value) return "";
  const at = new Date(value);
  return new Intl.DateTimeFormat("en-CA", { timeZone: businessZone(at), ...opts }).format(at);
}

export function formatDateTime(value: Date | string | null | undefined) {
  return formatDate(value, { dateStyle: "medium", timeStyle: "short" });
}

export function relativeDays(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

export function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

/** Fill {{placeholders}} in a message template. Unknown keys become empty. */
export function renderTemplate(template: string, vars: Record<string, string | null | undefined>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

export function formatAddress(p: { street?: string | null; unit?: string | null; city?: string | null; province?: string | null; postalCode?: string | null }) {
  const line1 = [p.unit ? `${p.unit} –` : null, p.street].filter(Boolean).join(" ");
  return [line1, p.city, [p.province, p.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

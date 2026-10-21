"use client";
import { Printer } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export function PrintButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn("inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2 print:hidden", className)}
    >
      <Printer className="size-4" aria-hidden /> Print / save as PDF
    </button>
  );
}

/** Opens the print dialog once the page has rendered (the staff "Print" button links here with ?print=1). */
export function AutoPrint() {
  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

/**
 * Remembers on this device which version of a work order was last opened, so the
 * next visit can highlight what changed. Scoped to the work order's own path.
 */
export function RememberSeenVersion({ path, version }: { path: string; version: number }) {
  useEffect(() => {
    try {
      document.cookie = `wo_seen=${version}; path=${path}; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
    } catch {
      // Cookies blocked: the page still works, it just can't highlight changes next time.
    }
  }, [path, version]);
  return null;
}

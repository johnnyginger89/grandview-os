"use client";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A card header with a two-or-more-way switch. Every panel is rendered on the
 * server and only shown or hidden here, so switching needs no request.
 */
export function Segmented({ label, header, options }: { label: string; header: ReactNode; options: { key: string; label: string; panel: ReactNode }[] }) {
  const [active, setActive] = useState(options[0]?.key);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">{header}</div>
        <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-md border border-border-strong bg-surface p-0.5">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={active === o.key}
              onClick={() => setActive(o.key)}
              className={cn("rounded px-2.5 py-1 text-xs font-medium transition-colors", active === o.key ? "bg-brand text-brand-contrast" : "text-muted hover:bg-surface-2 hover:text-text")}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {options.map((o) => (
        <div key={o.key} hidden={active !== o.key}>
          {o.panel}
        </div>
      ))}
    </>
  );
}

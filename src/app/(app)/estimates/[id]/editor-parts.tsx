"use client";
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import { evalQuantity } from "@/lib/estimating/dims-parse";
import { cn } from "@/lib/utils";

/**
 * Number box that only commits valid numbers, so half-typed values never break the maths.
 * With `sums`, "12*8+10*8" is worked out when you leave the box (or press Enter).
 */
export function NumInput({
  value,
  onCommit,
  disabled,
  className,
  placeholder,
  ariaLabel,
  title,
  sums,
  onEnter,
}: {
  value: string | null | undefined;
  onCommit: (v: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  ariaLabel: string;
  title?: string;
  sums?: boolean;
  onEnter?: () => void;
}) {
  const [text, setText] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  const shown = value ? String(Number(value)) : "";
  const settle = () => {
    if (!sums || /^\d*\.?\d*$/.test(text)) return;
    const v = evalQuantity(text);
    if (v !== null) {
      onCommit(v);
      setText(v);
    }
  };
  return (
    <input
      aria-label={ariaLabel}
      title={title}
      inputMode="decimal"
      enterKeyHint="next"
      disabled={disabled}
      placeholder={placeholder}
      value={focused ? text : shown}
      onFocus={(e) => {
        setFocused(true);
        setText(shown);
        e.target.select();
      }}
      onBlur={() => {
        settle();
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        settle();
        if (onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
      onChange={(e) => {
        const t = sums ? e.target.value.replace(/[^0-9.+*x× ]/gi, "") : e.target.value.replace(/[^0-9.]/g, "");
        setText(t);
        if (t === "") onCommit("");
        else if (/^\d*\.?\d+$|^\d+\.?$/.test(t)) onCommit(t.endsWith(".") ? t.slice(0, -1) : t);
      }}
      className={cn(
        "h-11 w-full rounded-md border border-border-strong bg-surface px-2 text-right text-sm tabular focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:border-transparent disabled:bg-transparent sm:h-9",
        className,
      )}
    />
  );
}

/** − n + for coats (0–6, like the rate form). */
export function Stepper({ value, onChange, disabled, label, min = 0, max = 6 }: { value: number; onChange: (n: number) => void; disabled?: boolean; label: string; min?: number; max?: number }) {
  const btn = "grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30 sm:size-8";
  return (
    <span className="inline-flex items-center rounded-md border border-border" role="group" aria-label={label}>
      {!disabled && (
        <button type="button" className={btn} aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          <Minus className="size-3.5" aria-hidden />
        </button>
      )}
      <span className="min-w-6 text-center text-sm font-medium tabular" aria-live="polite">
        {value}
      </span>
      {!disabled && (
        <button type="button" className={btn} aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          <Plus className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}

/** A row of buttons where one is chosen (prep level, sheen, tabs). */
export function Segmented<T extends string>({ label, options, value, onChange, disabled, className }: { label: string; options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; disabled?: boolean; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-9 rounded-full border px-3 text-xs font-medium",
            value === o.value ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:border-brand hover:text-brand",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A section that opens and closes, with a one-line summary when closed. */
export function Section({ title, summary, defaultOpen = false, children, id, action }: { title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode; id?: string; action?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center gap-2 px-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />}
          <span className="font-semibold">{title}</span>
          {summary && <span className="min-w-0 truncate text-sm text-muted">{summary}</span>}
        </button>
        {action}
      </div>
      {open && <div className="border-t border-border">{children}</div>}
    </section>
  );
}

export const chip = (on: boolean) =>
  cn("inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm", on ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:border-brand hover:text-brand");

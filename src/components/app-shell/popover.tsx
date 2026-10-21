"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A button that opens a small panel of links (the "+ New" and account menus).
 * Closes on Escape, on a click outside and when a link inside is chosen.
 */
export function Popover({
  label,
  button,
  buttonClassName,
  align = "right",
  children,
}: {
  label: string;
  button: ReactNode;
  buttonClassName?: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button ref={buttonRef} type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={buttonClassName}>
        {button}
      </button>
      {open && (
        <div role="group" aria-label={label} className={cn("absolute top-full z-50 mt-2 min-w-56 overflow-hidden rounded-xl border border-border bg-surface py-1.5 shadow-pop", align === "right" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export const popoverItem = "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-text hover:bg-surface-2";

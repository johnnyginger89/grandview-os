"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Phone sheet on a native modal <dialog>: focus stays inside, Esc and a tap on the
 * dimmed backdrop close it. "bottom" slides up from the bottom bar; "full" covers the screen.
 * Put `data-autofocus` on the control that should get focus first.
 */
export function Sheet({ open, onClose, label, kind, children }: { open: boolean; onClose: () => void; label: string; kind: "bottom" | "full"; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  // Sheets are phone-only: close one left open when the window grows to desktop width.
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const onChange = () => wide.matches && onClose();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open, onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={cn(
        "max-w-none border-0 bg-surface p-0 text-text backdrop:bg-black/40 lg:hidden",
        kind === "bottom" ? "mx-0 mt-auto mb-0 w-full max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]" : "m-0 h-dvh max-h-none w-full",
      )}
    >
      {open && children}
    </dialog>
  );
}

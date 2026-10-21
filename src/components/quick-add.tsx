"use client";
import { Calculator, Plus, UserPlus, Workflow, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const SHOW_ON = new Set(["/", "/leads", "/customers", "/estimates", "/projects"]);
const ITEMS = {
  lead: { href: "/leads/new", label: "Add lead", icon: Workflow },
  customer: { href: "/customers/new", label: "Add customer", icon: UserPlus },
  estimate: { href: "/estimates/new", label: "Add estimate", icon: Calculator },
} as const;
export type QuickAddItem = keyof typeof ITEMS;

/** Phone "+" button with the common "add" shortcuts. Only on list screens, so it never covers an editor. */
export function QuickAdd({ items }: { items: QuickAddItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!items.length || !SHOW_ON.has(pathname)) return null;
  return (
    <div className="lg:hidden print:hidden">
      {open && <button type="button" aria-label="Close" className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />}
      {open && (
        <div role="menu" aria-label="Add" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-2 gap-3 rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
          {items.map((k) => {
            const { href, label, icon: Icon } = ITEMS[k];
            return (
              <Link key={k} role="menuitem" href={href} onClick={() => setOpen(false)} className="flex h-14 items-center gap-3 rounded-lg border border-border px-4 font-medium active:bg-surface-2">
                <Icon className="size-5 text-brand" /> {label}
              </Link>
            );
          })}
        </div>
      )}
      <button
        type="button"
        aria-label={open ? "Close add menu" : "Add"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg active:brightness-95"
      >
        {open ? <X className="size-6" /> : <Plus className="size-7" />}
      </button>
    </div>
  );
}

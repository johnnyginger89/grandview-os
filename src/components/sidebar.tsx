"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  Calculator,
  CalendarDays,
  ChartColumn,
  FolderKanban,
  Gauge,
  HardHat,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const ICONS = { Gauge, ChartColumn, Workflow, Users, Calculator, FolderKanban, CalendarDays, BookOpen, Settings, ShieldCheck, HardHat } as const;
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

export function Sidebar({ items, userName, roleLabel }: { items: NavItem[]; userName: string; roleLabel: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Main">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-sidebar-active text-white shadow-[inset_3px_0_0_var(--accent)]" : "text-sidebar-text hover:bg-sidebar-active/60 hover:text-white",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 p-3">
      <Link href="/account/security" className="block rounded-md px-2 py-1.5 hover:bg-sidebar-active/60" onClick={() => setOpen(false)}>
        <p className="truncate text-sm font-medium text-white">{userName}</p>
        <p className="truncate text-xs text-sidebar-text">{roleLabel}</p>
      </Link>
      <button
        type="button"
        onClick={async () => {
          await authClient.signOut();
          window.location.href = "/login";
        }}
        className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-text hover:bg-sidebar-active/60 hover:text-white"
      >
        <LogOut className="size-4" aria-hidden /> Sign out
      </button>
    </div>
  );

  const brand = (
    <div className="flex h-14 items-center gap-2.5 px-4">
      <Image src="/brand/symbol-white.png" alt="Grandview Painting" width={32} height={32} priority />
      <span className="font-[family-name:var(--font-display)] text-base font-bold uppercase tracking-wide text-white">Grandview <span className="text-accent">OS</span></span>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar lg:flex">
        {brand}
        <div className="mt-2 flex flex-1 flex-col">{nav}</div>
        {footer}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="-ml-2 rounded-md p-2 text-muted" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <span className="flex items-center gap-2">
          <Image src="/brand/symbol-blue.png" alt="Grandview Painting" width={26} height={26} priority />
          <span className="font-[family-name:var(--font-display)] text-base font-bold uppercase tracking-wide text-brand">Grandview OS</span>
        </span>
        <span className="w-9" />
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-sidebar">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-sidebar-text" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-2 flex flex-1 flex-col overflow-y-auto">{nav}</div>
            {footer}
          </aside>
        </div>
      )}
    </>
  );
}

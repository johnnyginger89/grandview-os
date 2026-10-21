"use client";
import { Calculator, CalendarDays, ChevronRight, ClipboardCheck, Ellipsis, FileText, HardHat, House, LogOut, MessagesSquare, Plus, Search, Settings, ShieldCheck, Users, Workflow, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState, type ComponentType, type ReactNode } from "react";
import { QuickAdd, QUICK_ADD_ITEMS, type QuickAddItem } from "@/components/quick-add";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "./global-search";
import { NotificationsBell } from "./notifications-bell";
import { sectionFor, tabsFor, type IconName, type NavItem, type SectionTabs } from "./nav";
import { Popover, popoverItem } from "./popover";
import { Sheet } from "./sheet";

const ICONS: Record<IconName, ComponentType<{ className?: string }>> = {
  home: House,
  leads: Workflow,
  estimates: Calculator,
  jobs: ClipboardCheck,
  schedule: CalendarDays,
  "work-orders": FileText,
  customers: Users,
  "my-jobs": HardHat,
  chat: MessagesSquare,
  settings: Settings,
  search: Search,
  more: Ellipsis,
};

/** Sections that get their own spot in the phone bottom bar; the rest go under More. */
const PHONE_BAR: NavItem["key"][] = ["home", "leads", "estimates", "schedule"];
/** Painters and subs: their jobs and their chats. */
const FIELD_PHONE_BAR: NavItem["key"][] = ["my-jobs", "chat"];

export interface ShellUser {
  name: string;
  roleLabel: string;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
}

async function signOut() {
  await authClient.signOut();
  window.location.href = "/login";
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Grandview OS home">
      <Image src="/brand/symbol-blue.png" alt="" width={compact ? 26 : 30} height={compact ? 26 : 30} priority />
      <span className="font-[family-name:var(--font-display)] text-base font-bold uppercase tracking-wide text-brand">
        Grandview <span className="text-info">OS</span>
      </span>
    </Link>
  );
}

function AccountMenu({ user }: { user: ShellUser }) {
  return (
    <Popover
      label={`Account: ${user.name}`}
      buttonClassName="grid size-9 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand hover:ring-2 hover:ring-brand/20"
      button={<span aria-hidden>{initials(user.name)}</span>}
    >
      {(close) => (
        <>
          <div className="border-b border-border px-4 pt-1.5 pb-3">
            <p className="truncate text-sm font-semibold text-heading">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.roleLabel}</p>
          </div>
          <Link href="/account/security" onClick={close} className={cn(popoverItem, "mt-1.5")}>
            <ShieldCheck className="size-4 text-muted" aria-hidden /> Account &amp; security
          </Link>
          <button type="button" onClick={signOut} className={popoverItem}>
            <LogOut className="size-4 text-muted" aria-hidden /> Sign out
          </button>
        </>
      )}
    </Popover>
  );
}

function NewMenu({ items }: { items: QuickAddItem[] }) {
  if (!items.length) return null;
  return (
    <Popover
      label="New"
      buttonClassName="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-brand-contrast shadow-card hover:bg-brand-hover"
      button={
        <>
          <Plus className="size-4" aria-hidden /> New
        </>
      }
    >
      {(close) =>
        items.map((k) => {
          const { href, newLabel, icon: Icon } = QUICK_ADD_ITEMS[k];
          return (
            <Link key={k} href={href} onClick={close} className={popoverItem}>
              <Icon className="size-4 text-brand" aria-hidden /> {newLabel}
            </Link>
          );
        })
      }
    </Popover>
  );
}

function SideItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors",
        active ? "bg-sidebar-active text-white shadow-[inset_3px_0_0_var(--accent)]" : "text-sidebar-text hover:bg-white/10 hover:text-white",
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {item.label}
    </Link>
  );
}

function SectionTabStrip({ pathname, sections }: { pathname: string; sections: SectionTabs[] }) {
  const strip = tabsFor(pathname, sections);
  if (!strip) return null;
  return (
    <nav aria-label="Home" className="scrollbar-none -mt-1 mb-6 flex gap-6 overflow-x-auto border-b border-border print:hidden">
      {strip.tabs.map((t) => {
        const active = t.href === strip.active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 pt-1 pb-2.5 text-[15px] font-medium whitespace-nowrap transition-colors",
              active ? "border-brand text-brand" : "border-transparent text-muted hover:text-heading",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function BottomBar({ items, more, pathname, onMore, moreOpen }: { items: NavItem[]; more: boolean; pathname: string; onMore: () => void; moreOpen: boolean }) {
  const section = sectionFor(pathname);
  const cell = "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium";
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden">
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = section === item.key;
          return (
            <li key={item.key} className="flex-1">
              <Link href={item.href} aria-current={active ? "page" : undefined} className={cn(cell, active ? "text-brand" : "text-muted")}>
                <Icon className="size-6" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
        {more && (
          <li className="flex-1">
            <button type="button" onClick={onMore} aria-expanded={moreOpen} className={cn(cell, "w-full", moreOpen ? "text-brand" : "text-muted")}>
              <Ellipsis className="size-6" aria-hidden />
              More
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}

/**
 * The frame around every signed-in page: the menu (left on desktop, bottom bar on
 * phones), one search box, "+ New", the account menu, and the Today/Performance tabs.
 */
export function AppShell({
  nav,
  settings,
  sections,
  user,
  canSearch,
  newItems,
  children,
}: {
  nav: NavItem[];
  settings: NavItem | null;
  sections: SectionTabs[];
  user: ShellUser;
  canSearch: boolean;
  newItems: QuickAddItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<"search" | "more" | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  const items = nav;
  const section = sectionFor(pathname);
  const bar = items.some((n) => n.key === "home") ? PHONE_BAR : FIELD_PHONE_BAR;
  const barItems = items.filter((n) => bar.includes(n.key));
  const moreItems = [...items.filter((n) => !bar.includes(n.key)), ...(settings ? [settings] : [])];
  const hasBottomBar = barItems.length >= 2;

  return (
    <div
      className={cn(
        "min-h-screen [--app-top:3.5rem]",
        hasBottomBar && "[--app-bottom:calc(4rem+env(safe-area-inset-bottom))] lg:[--app-bottom:0px]",
      )}
    >
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar lg:flex print:hidden">
        <Link href="/" aria-label="Grandview Painting home" className="mx-3 mt-4 mb-2 flex justify-center rounded-lg px-3 py-2 hover:bg-white/5">
          <Image src="/brand/logo-white.png" alt="" width={176} height={80} priority />
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
          {items.map((item) => (
            <SideItem key={item.key} item={item} active={section === item.key} />
          ))}
        </nav>
        {settings && (
          <div className="border-t border-white/10 p-3">
            <SideItem item={settings} active={section === "settings"} />
          </div>
        )}
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 hidden h-14 items-center gap-4 border-b border-border bg-surface/95 px-6 backdrop-blur lg:flex print:hidden">
          {canSearch ? <GlobalSearch variant="bar" /> : <span className="flex-1" />}
          <div className="ml-auto flex items-center gap-3">
            <NewMenu items={newItems} />
            <NotificationsBell />
            <AccountMenu user={user} />
          </div>
        </header>

        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4 lg:hidden print:hidden">
          <Brand compact />
          <div className="flex items-center gap-1">
            <NotificationsBell />
            {canSearch && (
              <button type="button" onClick={() => setSheet("search")} aria-label="Search" className="grid size-11 place-items-center rounded-lg text-heading hover:bg-surface-2">
                <Search className="size-6" aria-hidden />
              </button>
            )}
            <AccountMenu user={user} />
          </div>
        </header>

        <main className="pb-[calc(var(--app-bottom)+1.5rem)] lg:pb-8">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <SectionTabStrip pathname={pathname} sections={sections} />
            {children}
          </div>
        </main>
      </div>

      {canSearch && (
          <Sheet open={sheet === "search"} onClose={closeSheet} label="Search" kind="full">
            <div className="flex h-full flex-col">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
                <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-heading">Search</h2>
                <button type="button" onClick={closeSheet} aria-label="Close search" className="-mr-2 grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2">
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              <GlobalSearch variant="sheet" onNavigate={closeSheet} />
            </div>
          </Sheet>
      )}
      {hasBottomBar && (
        <>
          <BottomBar items={barItems} more={moreItems.length > 0} pathname={pathname} onMore={() => setSheet("more")} moreOpen={sheet === "more"} />
          <Sheet open={sheet === "more"} onClose={closeSheet} label="More" kind="bottom">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-heading">More</h2>
              <button type="button" onClick={closeSheet} aria-label="Close" className="-mr-2 grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <ul className="divide-y divide-border px-2 pb-3">
              {moreItems.map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <li key={item.key}>
                    <Link href={item.href} onClick={closeSheet} aria-current={section === item.key ? "page" : undefined} className="flex min-h-14 items-center gap-4 rounded-lg px-3 text-base font-medium text-text active:bg-surface-2">
                      <Icon className="size-5 text-brand" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      <ChevronRight className="size-4 text-subtle" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Sheet>
        </>
      )}

      <QuickAdd items={newItems} />
    </div>
  );
}

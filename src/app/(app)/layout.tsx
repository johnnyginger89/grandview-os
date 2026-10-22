import { AppShell } from "@/components/app-shell/app-shell";
import type { NavItem, SectionTab, SectionTabs } from "@/components/app-shell/nav";
import type { QuickAddItem } from "@/components/quick-add";
import { requireUser } from "@/lib/authz/guard";
import { can, ROLE_LABELS, type Permission } from "@/lib/authz/permissions";
import { canSearch } from "@/server/search";
import { canOpenMyJobs } from "./my-jobs/access";

const HOME_TABS: (SectionTab & { permission: Permission })[] = [
  { href: "/", label: "Today", permission: "dashboard.view" },
  { href: "/performance", label: "Performance", permission: "dashboard.view" },
];

/** The menu, in order. Rates live under Settings. */
const NAV: (NavItem & { permission: Permission })[] = [
  { key: "home", href: "/", label: "Home", icon: "home", permission: "dashboard.view" },
  { key: "leads", href: "/leads", label: "Leads", icon: "leads", permission: "pipeline.read" },
  { key: "estimates", href: "/estimates", label: "Estimates", icon: "estimates", permission: "estimates.read" },
  { key: "jobs", href: "/projects", label: "Jobs", icon: "jobs", permission: "projects.read_all" },
  { key: "schedule", href: "/schedule", label: "Schedule", icon: "schedule", permission: "schedule.read" },
  { key: "work-orders", href: "/work-orders", label: "Work orders", icon: "work-orders", permission: "projects.read_all" },
  { key: "customers", href: "/customers", label: "Customers", icon: "customers", permission: "customers.read" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowSetupPending: true });
  const myJobs = await canOpenMyJobs(user);
  const homeTabs = HOME_TABS.filter((t) => can(user.role, t.permission)).map(({ href, label }) => ({ href, label }));

  const nav: NavItem[] = [
    ...NAV.filter((n) => can(user.role, n.permission)).map(({ key, href, label, icon }) => ({ key, href, label, icon })),
    // Field roles, plus office staff who also belong to a crew (feasibility review F28).
    ...(myJobs ? [{ key: "my-jobs", href: "/my-jobs", label: "My Jobs", icon: "my-jobs" } as const] : []),
    // One chat per job: office staff see every job's, crews the jobs they're on.
    ...(myJobs || can(user.role, "projects.read_all") ? [{ key: "chat", href: "/chat", label: "Chat", icon: "chat" } as const] : []),
  ];
  // Estimators can read rates but not change settings: their Settings opens on Rates.
  const settingsHref = can(user.role, "settings.manage") ? "/settings" : can(user.role, "rates.read") ? "/rates" : null;
  const sections: SectionTabs[] = [{ key: "home", tabs: homeTabs }];
  const newItems: QuickAddItem[] = [
    ...(can(user.role, "pipeline.write") ? (["lead"] as const) : []),
    ...(can(user.role, "customers.write") ? (["customer"] as const) : []),
    ...(can(user.role, "estimates.write") ? (["estimate"] as const) : []),
  ];

  return (
    <AppShell
      nav={nav}
      settings={settingsHref ? { key: "settings", href: settingsHref, label: "Settings", icon: "settings" } : null}
      sections={sections}
      user={{ name: user.name, roleLabel: ROLE_LABELS[user.role] }}
      canSearch={canSearch(user.role)}
      newItems={newItems}
    >
      {children}
    </AppShell>
  );
}

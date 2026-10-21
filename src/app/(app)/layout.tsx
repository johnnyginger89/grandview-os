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
/** Leads, estimates and sold jobs are one section: everything from first call to finished job. */
const JOBS_TABS: (SectionTab & { permission: Permission })[] = [
  { href: "/leads", label: "Leads", permission: "pipeline.read" },
  { href: "/estimates", label: "Estimates", permission: "estimates.read" },
  { href: "/projects", label: "Sold jobs", permission: "projects.read_all" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowMfaPending: true });
  const myJobs = await canOpenMyJobs(user);
  const allowed = (list: (SectionTab & { permission: Permission })[]): SectionTab[] => list.filter((t) => can(user.role, t.permission)).map(({ href, label }) => ({ href, label }));
  const homeTabs = allowed(HOME_TABS);
  const jobsTabs = allowed(JOBS_TABS);

  const nav: NavItem[] = [
    ...(homeTabs.length ? [{ key: "home", href: "/", label: "Home", icon: "home" } as const] : []),
    ...(jobsTabs.length ? [{ key: "jobs", href: jobsTabs[0].href, label: "Jobs", icon: "jobs" } as const] : []),
    ...(can(user.role, "schedule.read") ? [{ key: "schedule", href: "/schedule", label: "Schedule", icon: "schedule" } as const] : []),
    ...(can(user.role, "customers.read") ? [{ key: "customers", href: "/customers", label: "Customers", icon: "customers" } as const] : []),
    ...(can(user.role, "rates.read") ? [{ key: "rates", href: "/rates", label: "Rates", icon: "rates" } as const] : []),
    // Field roles, plus office staff who also belong to a crew (feasibility review F28).
    ...(myJobs ? [{ key: "my-jobs", href: "/my-jobs", label: "My Jobs", icon: "my-jobs" } as const] : []),
  ];
  const sections: SectionTabs[] = [
    { key: "home", tabs: homeTabs },
    { key: "jobs", tabs: jobsTabs },
  ];
  const newItems: QuickAddItem[] = [
    ...(can(user.role, "pipeline.write") ? (["lead"] as const) : []),
    ...(can(user.role, "customers.write") ? (["customer"] as const) : []),
    ...(can(user.role, "estimates.write") ? (["estimate"] as const) : []),
  ];

  return (
    <AppShell
      nav={nav}
      settings={can(user.role, "settings.manage") ? { key: "settings", href: "/settings", label: "Settings", icon: "settings" } : null}
      sections={sections}
      user={{ name: user.name, roleLabel: ROLE_LABELS[user.role] }}
      canSearch={canSearch(user.role)}
      newItems={newItems}
    >
      {children}
    </AppShell>
  );
}

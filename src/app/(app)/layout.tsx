import { QuickAdd, type QuickAddItem } from "@/components/quick-add";
import { Sidebar, type NavItem } from "@/components/sidebar";
import { requireUser } from "@/lib/authz/guard";
import { can, ROLE_LABELS, type Permission } from "@/lib/authz/permissions";
import { canOpenMyJobs } from "./my-jobs/access";

const NAV: (NavItem & { permission: Permission; orCrewMember?: true })[] = [
  { href: "/", label: "Dashboard", icon: "Gauge", permission: "dashboard.view" },
  { href: "/performance", label: "Performance", icon: "ChartColumn", permission: "dashboard.view" },
  // Also for office staff who belong to a crew (feasibility review F28).
  { href: "/my-jobs", label: "My Jobs", icon: "HardHat", permission: "projects.read_assigned", orCrewMember: true },
  { href: "/leads", label: "Leads & Pipeline", icon: "Workflow", permission: "pipeline.read" },
  { href: "/customers", label: "Customers", icon: "Users", permission: "customers.read" },
  { href: "/estimates", label: "Estimates", icon: "Calculator", permission: "estimates.read" },
  { href: "/projects", label: "Projects", icon: "FolderKanban", permission: "projects.read_all" },
  { href: "/schedule", label: "Schedule", icon: "CalendarDays", permission: "schedule.read" },
  { href: "/rates", label: "Rate Library", icon: "BookOpen", permission: "rates.read" },
  { href: "/settings", label: "Settings", icon: "Settings", permission: "settings.manage" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowMfaPending: true });
  const myJobs = await canOpenMyJobs(user);
  const items: NavItem[] = NAV.filter((n) => can(user.role, n.permission) || (n.orCrewMember && myJobs)).map((n) => ({ href: n.href, label: n.label, icon: n.icon }));
  const quickAdd: QuickAddItem[] = [
    ...(can(user.role, "pipeline.write") ? (["lead"] as const) : []),
    ...(can(user.role, "customers.write") ? (["customer"] as const) : []),
    ...(can(user.role, "estimates.write") ? (["estimate"] as const) : []),
  ];
  return (
    <div className="min-h-screen">
      <Sidebar items={items} userName={user.name} roleLabel={ROLE_LABELS[user.role]} />
      <main className="lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
      <QuickAdd items={quickAdd} />
    </div>
  );
}

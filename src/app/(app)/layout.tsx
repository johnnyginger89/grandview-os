import { Sidebar, type NavItem } from "@/components/sidebar";
import { requireUser } from "@/lib/authz/guard";
import { can, ROLE_LABELS, type Permission } from "@/lib/authz/permissions";

const NAV: (NavItem & { permission: Permission })[] = [
  { href: "/", label: "Dashboard", icon: "Gauge", permission: "dashboard.view" },
  { href: "/my-jobs", label: "My Jobs", icon: "HardHat", permission: "projects.read_assigned" },
  { href: "/leads", label: "Leads & Pipeline", icon: "Workflow", permission: "pipeline.read" },
  { href: "/customers", label: "Customers", icon: "Users", permission: "customers.read" },
  { href: "/estimates", label: "Estimates", icon: "Calculator", permission: "estimates.read" },
  { href: "/projects", label: "Projects", icon: "FolderKanban", permission: "projects.read_all" },
  { href: "/rates", label: "Rate Library", icon: "BookOpen", permission: "rates.read" },
  { href: "/settings", label: "Settings", icon: "Settings", permission: "settings.manage" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowMfaPending: true });
  const items = NAV.filter((n) => can(user.role, n.permission)).map(({ permission: _p, ...n }) => n);
  return (
    <div className="min-h-screen">
      <Sidebar items={items} userName={user.name} roleLabel={ROLE_LABELS[user.role]} />
      <main className="lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}

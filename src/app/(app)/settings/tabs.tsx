import Link from "next/link";
import type { Role } from "@/db/schema/auth";
import { can } from "@/lib/authz/permissions";

export interface SettingsTab {
  key: string;
  label: string;
  href: string;
  /** Pages and actions still check permissions themselves; this only decides what the tab bar shows. */
  visible: (role: Role) => boolean;
}

const manage = (role: Role) => can(role, "settings.manage");

export const TABS: readonly SettingsTab[] = [
  { key: "company", label: "Company", href: "/settings?tab=company", visible: manage },
  { key: "pricing", label: "Pricing defaults", href: "/settings?tab=pricing", visible: manage },
  { key: "proposals", label: "Proposals", href: "/settings/proposals", visible: manage },
  // Goals are company revenue targets, so they also need financials.read (owner only by default).
  { key: "goals", label: "Goals", href: "/settings?tab=goals", visible: (r) => manage(r) && can(r, "financials.read") },
  { key: "lists", label: "Pick lists", href: "/settings?tab=lists", visible: manage },
  { key: "templates", label: "Email templates", href: "/settings?tab=templates", visible: manage },
  { key: "work-orders", label: "Work orders", href: "/settings?tab=work-orders", visible: manage },
  { key: "users", label: "Users", href: "/settings?tab=users", visible: (r) => manage(r) && can(r, "users.manage") },
  { key: "integrations", label: "Integrations", href: "/settings?tab=integrations", visible: manage },
  { key: "import", label: "Import", href: "/settings/import", visible: manage },
];

/** False for a known tab the role may not open; unknown keys are left to the page. */
export function settingsTabAllowed(key: string, role: Role): boolean {
  const tab = TABS.find((t) => t.key === key);
  return !tab || tab.visible(role);
}

export function SettingsTabs({ active, role }: { active: string; role: Role }) {
  return (
    <nav aria-label="Settings tabs" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.filter((t) => t.visible(role)).map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active === t.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-text"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

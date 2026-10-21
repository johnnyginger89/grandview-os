import Link from "next/link";

const TABS = [
  { key: "company", label: "Company", href: "/settings?tab=company" },
  { key: "pricing", label: "Pricing defaults", href: "/settings?tab=pricing" },
  { key: "proposals", label: "Proposals", href: "/settings/proposals" },
  { key: "lists", label: "Pick lists", href: "/settings?tab=lists" },
  { key: "templates", label: "Email templates", href: "/settings?tab=templates" },
  { key: "users", label: "Users", href: "/settings?tab=users" },
  { key: "integrations", label: "Integrations", href: "/settings?tab=integrations" },
  { key: "import", label: "Import", href: "/settings/import" },
];

export function SettingsTabs({ active, showUsers }: { active: string; showUsers: boolean }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.filter((t) => t.key !== "users" || showUsers).map((t) => (
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

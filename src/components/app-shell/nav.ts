/**
 * The app's sections. One list drives the desktop menu, the phone bottom bar and
 * the "More" sheet, so they always agree. Pages still check permissions themselves;
 * this only decides what is shown.
 */

export type SectionKey = "home" | "jobs" | "schedule" | "customers" | "rates" | "my-jobs" | "settings";
export type IconName = "home" | "jobs" | "schedule" | "customers" | "rates" | "my-jobs" | "settings" | "search" | "more";

export interface NavItem {
  key: SectionKey;
  href: string;
  label: string;
  icon: IconName;
}

export interface SectionTab {
  href: string;
  label: string;
}

/** Tabs shown at the top of a section's main pages (not on detail pages). */
export interface SectionTabs {
  key: "home" | "jobs";
  tabs: SectionTab[];
}

/** URL prefixes each section owns, longest first where they overlap. */
const SECTION_PATHS: [SectionKey, string[]][] = [
  ["my-jobs", ["/my-jobs"]],
  ["jobs", ["/leads", "/estimates", "/projects"]],
  ["schedule", ["/schedule"]],
  ["customers", ["/customers"]],
  ["rates", ["/rates"]],
  ["settings", ["/settings", "/account"]],
  ["home", ["/performance"]],
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function sectionFor(pathname: string): SectionKey | null {
  if (pathname === "/") return "home";
  for (const [key, prefixes] of SECTION_PATHS) if (prefixes.some((p) => under(pathname, p))) return key;
  return null;
}

/** The tab strip for this exact page, if it is one of a section's main pages. */
export function tabsFor(pathname: string, sections: SectionTabs[]): { key: SectionTabs["key"]; tabs: SectionTab[]; active: string } | null {
  for (const s of sections) {
    const hit = s.tabs.find((t) => t.href === pathname);
    if (hit && s.tabs.length > 1) return { key: s.key, tabs: s.tabs, active: hit.href };
  }
  return null;
}

export const LAST_JOBS_TAB_KEY = "gv.jobs-tab";

/** Where "Jobs" in the menu goes: the tab used last, if this person may still open it. */
export function jobsHref(saved: string | null, tabs: SectionTab[], fallback: string): string {
  return saved && tabs.some((t) => t.href === saved) ? saved : fallback;
}

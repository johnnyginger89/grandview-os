import type { Tone } from "@/components/ui";

export type SearchKind = "customer" | "job" | "estimate" | "lead" | "work_order";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  detail: string;
  status: { label: string; tone: Tone } | null;
  href: string;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  hits: SearchHit[];
  /** True when there were more matches than shown. */
  more: boolean;
}

export interface SearchResult {
  query: string;
  groups: SearchGroup[];
}

export const searchPageHref = (q: string) => `/search?${new URLSearchParams({ q: q.trim() })}`;

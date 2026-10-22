/**
 * Paging for the long office lists (customers, estimates, jobs, work orders): the page
 * number in the URL, which rows a page holds, and links that keep the list's search and
 * filters. Pure, so every list follows the same rules (covered by paging.test.ts).
 */

/** Rows per page. */
export const PAGE_SIZE = 100;
/** Far past any real list; keeps a typed-in ?page=99999999 from asking for a huge offset. */
const MAX_PAGE = 10_000;

type Param = string | string[] | undefined;

/** One value of a search param: the first when it's repeated (?q=a&q=b). */
export function firstParam(v: Param): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** ?page=3 → 3. Missing, 0, negative or not a whole number → 1. */
export function parsePage(v: Param): number {
  const s = firstParam(v).trim();
  return /^\d{1,9}$/.test(s) ? Math.min(Math.max(Number(s), 1), MAX_PAGE) : 1;
}

export interface PageInfo {
  /** 1-based, never past the last page. */
  page: number;
  /** At least 1, even when nothing matches. */
  pages: number;
  /** Rows matching the search and filters, across every page. */
  total: number;
  /** Positions of the first and last row shown, from 1 (both 0 when there are none). */
  from: number;
  to: number;
}

export interface Paged<T> extends PageInfo {
  rows: T[];
}

/** The pages `total` rows need, and the requested page kept inside them. */
export function clampPage(requested: number, total: number, size = PAGE_SIZE): { page: number; pages: number; offset: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(requested) || 1), pages);
  return { page, pages, offset: (page - 1) * size };
}

/**
 * One page of a list: counts the matching rows while fetching the page. A page past the end
 * (an old link, or a shorter list since) shows the last page instead of an empty one.
 */
export async function loadPage<T>(
  requested: number,
  count: () => Promise<number>,
  rows: (limit: number, offset: number) => Promise<T[]>,
  size = PAGE_SIZE,
): Promise<Paged<T>> {
  const want = Math.max(1, Math.floor(requested) || 1);
  const [total, first] = await Promise.all([count(), rows(size, (want - 1) * size)]);
  const { page, pages, offset } = clampPage(want, total, size);
  const list = page === want ? first : await rows(size, offset);
  return { rows: list, page, pages, total: Math.max(total, offset + list.length), from: list.length ? offset + 1 : 0, to: offset + list.length };
}

/** Link to a page of a list, keeping its search and filters. Page 1 has no ?page, and blanks are left out. */
export function pageHref(path: string, params: Record<string, string | undefined>, page: number): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

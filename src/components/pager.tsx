import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { pageHref, type PageInfo } from "@/lib/paging";

const count = (n: number) => n.toLocaleString("en-CA");
const unavailable = "pointer-events-none opacity-50";

/**
 * "Showing 1–100 of 1,240" under a long list, with Previous and Next when there's more than
 * one page. The links keep the list's search and filters (`params`); changing those starts
 * again at page 1.
 */
export function Pager({ info, path, params = {} }: { info: PageInfo; path: string; params?: Record<string, string | undefined> }) {
  if (!info.total) return null;
  const shown = info.from === info.to ? count(info.from) : `${count(info.from)}–${count(info.to)}`;
  const prev = info.page > 1;
  const next = info.page < info.pages;
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted tabular">
        Showing {shown} of {count(info.total)}
      </p>
      {info.pages > 1 && (
        <div className="flex gap-2">
          {prev ? (
            <Link href={pageHref(path, params, info.page - 1)} rel="prev" className={buttonClass("secondary")}>
              <ChevronLeft className="size-4" aria-hidden /> Previous
            </Link>
          ) : (
            <span aria-disabled="true" className={buttonClass("secondary", "md", unavailable)}>
              <ChevronLeft className="size-4" aria-hidden /> Previous
            </span>
          )}
          {next ? (
            <Link href={pageHref(path, params, info.page + 1)} rel="next" className={buttonClass("secondary")}>
              Next <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <span aria-disabled="true" className={buttonClass("secondary", "md", unavailable)}>
              Next <ChevronRight className="size-4" aria-hidden />
            </span>
          )}
        </div>
      )}
    </nav>
  );
}

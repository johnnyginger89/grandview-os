import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * One headline number. `testId` goes on the tile and the raw decimal string on
 * the value as `data-value`, so tests can read exact amounts. A tile holds
 * exactly one `data-value`.
 */
export function KpiTile({
  testId,
  label,
  value,
  raw,
  delta,
  hint,
  title,
  href,
  children,
  className,
  plain,
}: {
  testId: string;
  label: string;
  value: ReactNode;
  raw: string | null;
  delta?: ReactNode;
  hint?: ReactNode;
  title?: string;
  href?: string;
  children?: ReactNode;
  className?: string;
  /** No card of its own, for a tile placed inside a larger card. */
  plain?: boolean;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 break-words text-xl font-semibold text-text sm:text-2xl" data-value={raw ?? ""}>
        {value}
      </p>
      {delta}
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
      {children}
    </>
  );
  if (plain)
    return (
      <div data-testid={testId} title={title} className={cn("min-w-0", className)}>
        {body}
      </div>
    );
  if (href)
    return (
      <Link href={href} data-testid={testId} title={title} className={cn("block min-w-0 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong", className)}>
        {body}
      </Link>
    );
  return (
    <Card data-testid={testId} title={title} className={cn("min-w-0 p-4", className)}>
      {body}
    </Card>
  );
}

import Link from "next/link";
import { businessZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ChannelSummary } from "@/server/job-chat";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: businessZone(x) }).format(x);
  return day(d) === day(new Date())
    ? new Intl.DateTimeFormat("en-CA", { timeZone: businessZone(d), hour: "numeric", minute: "2-digit" }).format(d)
    : new Intl.DateTimeFormat("en-CA", { timeZone: businessZone(d), month: "short", day: "numeric" }).format(d);
}

/** Every job chat the viewer can open, busiest first, with unread counts. */
export function ChannelList({ channels, activeId, className }: { channels: ChannelSummary[]; activeId?: string; className?: string }) {
  if (!channels.length) return <p className={cn("p-4 text-sm text-muted", className)}>No job chats yet. Each job gets one; you&apos;ll see it here once you&apos;re booked on a job.</p>;
  return (
    <ul className={cn("divide-y divide-border", className)} aria-label="Job chats">
      {channels.map((c) => (
        <li key={c.projectId}>
          <Link
            href={`/chat/${c.projectId}`}
            aria-current={c.projectId === activeId ? "page" : undefined}
            className={cn("flex gap-3 px-4 py-3 hover:bg-surface-2", c.projectId === activeId && "bg-brand-soft hover:bg-brand-soft")}
          >
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-sm", c.unread ? "font-semibold text-heading" : "font-medium text-text")}>
                #{c.projectNumber} {c.title}
              </span>
              <span className="block truncate text-xs text-muted">{c.lastText ?? "No messages yet"}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs text-subtle">{when(c.lastAt)}</span>
              {c.unread > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] leading-5 font-semibold text-white" aria-label={`${c.unread} unread`}>{c.unread > 99 ? "99+" : c.unread}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

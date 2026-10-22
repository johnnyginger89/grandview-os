import { MessagesSquare } from "lucide-react";
import { Card, CardHeader, LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/authz/guard";
import { businessZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { channelAccess, listMessages } from "@/server/job-chat";

const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: businessZone(iso), month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** The job's chat on its page: the last few messages and a way in. */
export async function ChatCard({ projectId, className }: { projectId: string; className?: string }) {
  const viewer = await getCurrentUser();
  if (!viewer || !(await channelAccess(viewer, projectId))) return null;
  const page = await listMessages(viewer, projectId);
  const recent = (page?.messages ?? []).slice(-3);
  return (
    <Card className={cn(className)} role="region" aria-label="Job chat">
      <CardHeader
        title="Job chat"
        description="Messages, photos and daily updates from everyone on this job."
        action={
          <LinkButton href={`/chat/${projectId}`} size="sm" variant="secondary">
            <MessagesSquare className="size-4" aria-hidden /> Open chat
          </LinkButton>
        }
      />
      {recent.length ? (
        <ul className="divide-y divide-border text-sm">
          {recent.map((m) => (
            <li key={m.id} className="px-4 py-2.5">
              <p className="text-xs text-muted">
                {m.kind === "system" ? "Grandview OS" : (m.authorName ?? "Someone")} · {when(m.createdAt)}
                {m.kind === "daily_update" ? ` · Daily update${m.percentComplete != null ? `, ${m.percentComplete}% done` : ""}` : ""}
              </p>
              <p className="line-clamp-2 break-words">{m.body || `${m.photos.length} ${m.photos.length === 1 ? "photo" : "photos"}`}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted">No messages yet.</p>
      )}
    </Card>
  );
}

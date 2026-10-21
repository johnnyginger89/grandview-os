import { MessagesSquare } from "lucide-react";
import { ChannelList } from "@/components/chat/channel-list";
import { requireUser } from "@/lib/authz/guard";
import { listChannels } from "@/server/job-chat";

export const metadata = { title: "Chat" };

/** All job chats; on a computer, pick one on the left. */
export default async function ChatPage() {
  const user = await requireUser();
  const channels = await listChannels(user);
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr] [&>*]:min-w-0">
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-card" aria-labelledby="chat-title">
        <h1 id="chat-title" className="border-b border-border px-4 py-3 text-[15px] font-semibold text-heading">Job chats</h1>
        <ChannelList channels={channels} />
      </section>
      <div className="hidden place-items-center rounded-xl border border-dashed border-border-strong p-10 text-center text-sm text-muted lg:grid">
        <div>
          <MessagesSquare className="mx-auto mb-2 size-8 text-subtle" aria-hidden />
          Pick a job to see its messages, photos and daily updates.
        </div>
      </div>
    </div>
  );
}

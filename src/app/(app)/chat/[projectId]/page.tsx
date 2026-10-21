import { notFound } from "next/navigation";
import { ChannelList } from "@/components/chat/channel-list";
import { ChatRoom } from "@/components/chat/chat-room";
import { requireUser } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { channelAccess, channelMembers, listChannels, listMessages, markChannelRead } from "@/server/job-chat";
import { addMemberAction, removeMemberAction } from "./actions";

export const metadata = { title: "Job chat" };

export default async function JobChatPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ update?: string }> }) {
  const { projectId } = await params;
  const { update } = await searchParams;
  const user = await requireUser();
  const access = await channelAccess(user, projectId);
  if (!access) notFound();
  const [page, people, channels] = await Promise.all([listMessages(user, projectId), channelMembers(projectId), listChannels(user)]);
  if (!page) notFound();
  await markChannelRead(user, projectId);
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr] [&>*]:min-w-0">
      <section className="hidden overflow-hidden rounded-xl border border-border bg-surface shadow-card lg:block" aria-label="Job chats">
        <h2 className="border-b border-border px-4 py-3 text-[15px] font-semibold text-heading">Job chats</h2>
        <div className="max-h-[calc(100dvh-var(--app-top)-8rem)] overflow-y-auto">
          <ChannelList channels={channels.map((c) => (c.projectId === projectId ? { ...c, unread: 0 } : c))} activeId={projectId} />
        </div>
      </section>
      <ChatRoom
        channel={{ projectId, number: access.project.number, title: access.project.title, status: access.project.status }}
        initial={page}
        members={people.members}
        candidates={people.candidates}
        canManage={access.canManage}
        startWithUpdate={update === "1"}
        jobHref={can(user.role, "projects.read_all") ? `/projects/${projectId}` : null}
        backHref="/chat"
        addMember={addMemberAction.bind(null, projectId)}
        removeMember={removeMemberAction.bind(null, projectId)}
      />
    </div>
  );
}

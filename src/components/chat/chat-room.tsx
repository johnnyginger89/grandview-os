"use client";
import { ArrowLeft, Camera, ImagePlus, Loader2, Send, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Badge, Button, FormError, Select } from "@/components/ui";
import { resizePhoto } from "@/lib/chat/resize";
import { businessZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ChannelMember, MessageDTO } from "@/server/job-chat";

/*
 * A job's chat: messages, photos and end-of-day updates, newest at the bottom. New
 * messages are fetched every few seconds while the page is on screen; phones are told
 * about them by the notification bell and push.
 */

type Result = { ok: true } | { ok: false; error: string };

export interface ChatRoomProps {
  channel: { projectId: string; number: number; title: string; status: string };
  initial: { messages: MessageDTO[]; hasMore: boolean };
  members: ChannelMember[];
  candidates: { id: string; name: string; roleLabel: string }[];
  canManage: boolean;
  /** Opened from the 4 pm reminder: start a daily update. */
  startWithUpdate: boolean;
  jobHref: string | null;
  backHref: string;
  addMember: (userId: string) => Promise<Result>;
  removeMember: (userId: string) => Promise<Result>;
}

const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: businessZone(iso) }).format(new Date(iso));
const timeOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: businessZone(iso), hour: "numeric", minute: "2-digit" }).format(new Date(iso));
function dayLabel(iso: string): string {
  const k = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (k === today) return "Today";
  if (k === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-CA", { timeZone: businessZone(iso), weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}
const initials = (name: string | null) =>
  (name ?? "?")
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

const WHY: Record<ChannelMember["why"], string> = { always: "Always in every job", project_manager: "Project manager", booked: "Booked on this job", added: "Added" };
const PERCENTS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

interface Pending {
  key: string;
  preview: string;
  id: string | null;
  error: string | null;
}

export function ChatRoom(props: ChatRoomProps) {
  const { channel } = props;
  const router = useRouter();
  const [messages, setMessages] = useState<MessageDTO[]>(props.initial.messages);
  const [hasMore, setHasMore] = useState(props.initial.hasMore);
  const [text, setText] = useState("");
  const [daily, setDaily] = useState(props.startWithUpdate);
  const [percent, setPercent] = useState<string>("");
  const [photos, setPhotos] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const base = `/api/chat/${channel.projectId}`;

  const merge = useCallback((incoming: MessageDTO[], where: "end" | "start") => {
    setMessages((list) => {
      const have = new Set(list.map((m) => m.id));
      const fresh = incoming.filter((m) => !have.has(m.id));
      return where === "end" ? [...list, ...fresh] : [...fresh, ...list];
    });
  }, []);

  const lastAt = messages.at(-1)?.createdAt ?? null;
  const poll = useCallback(() => {
    const q = new URLSearchParams({ read: "1", ...(lastAt ? { after: lastAt } : {}) });
    fetch(`${base}/messages?${q}`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<{ messages: MessageDTO[] }>) : null))
      .then((d) => d && d.messages.length && merge(d.messages, "end"))
      .catch(() => undefined);
  }, [base, lastAt, merge]);

  useEffect(() => {
    poll();
    const tick = () => document.visibilityState === "visible" && poll();
    const timer = window.setInterval(tick, 8000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [poll]);

  // Keep the newest message in view unless the reader has scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const older = () => {
    const first = messages[0]?.createdAt;
    if (!first) return;
    const el = listRef.current;
    const before = el?.scrollHeight ?? 0;
    fetch(`${base}/messages?before=${encodeURIComponent(first)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ messages: MessageDTO[]; hasMore: boolean }>) : null))
      .then((d) => {
        if (!d) return;
        stick.current = false;
        merge(d.messages, "start");
        setHasMore(d.hasMore);
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - before;
        });
      })
      .catch(() => undefined);
  };

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of [...files].slice(0, 10 - photos.length)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const preview = URL.createObjectURL(file);
      setPhotos((p) => [...p, { key, preview, id: null, error: null }]);
      try {
        const r = await resizePhoto(file);
        const form = new FormData();
        form.set("photo", r.photo, "photo.jpg");
        form.set("thumb", r.thumb, "thumb.jpg");
        form.set("width", String(r.width));
        form.set("height", String(r.height));
        const res = await fetch(`${base}/photos`, { method: "POST", body: form });
        const body = (await res.json().catch(() => ({}))) as { photo?: { id: string }; error?: string };
        if (!res.ok || !body.photo) throw new Error(body.error ?? "That photo didn't upload. Try again.");
        setPhotos((p) => p.map((x) => (x.key === key ? { ...x, id: body.photo!.id } : x)));
      } catch (e) {
        setPhotos((p) => p.map((x) => (x.key === key ? { ...x, error: e instanceof Error ? e.message : "That photo didn't upload." } : x)));
      }
    }
  }

  const uploading = photos.some((p) => !p.id && !p.error);
  const ready = photos.filter((p) => p.id).map((p) => p.id!);
  const canSend = !sending && !uploading && (text.trim().length > 0 || ready.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, kind: daily ? "daily_update" : "message", percentComplete: daily && percent !== "" ? Number(percent) : null, photoIds: ready }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: MessageDTO; error?: string };
      if (!res.ok || !body.message) throw new Error(body.error ?? "The message didn't send. Try again.");
      stick.current = true;
      merge([body.message], "end");
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
      setPhotos([]);
      setText("");
      setDaily(false);
      setPercent("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The message didn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  let lastDay = "";
  return (
    <div className="flex h-[calc(100dvh-var(--app-top)-var(--app-bottom)-3.5rem)] min-h-[26rem] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4">
        <Link href={props.backHref} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 lg:hidden" aria-label="All chats">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-heading">#{channel.number} {channel.title}</h1>
          {props.jobHref ? (
            <Link href={props.jobHref} className="text-xs text-brand hover:underline">Open the job</Link>
          ) : (
            <p className="text-xs text-muted">Job chat</p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setPeopleOpen(true)} aria-label={`People in this chat: ${props.members.length}`}>
          <Users className="size-4" aria-hidden /> {props.members.length}
        </Button>
      </header>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 space-y-1 overflow-y-auto px-3 py-3 sm:px-4"
        role="log"
        aria-label="Messages"
        aria-live="polite"
      >
        {hasMore && (
          <div className="pb-2 text-center">
            <Button size="sm" variant="ghost" onClick={older}>Show older messages</Button>
          </div>
        )}
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">No messages yet. Say hello, post photos, or send the first daily update.</p>
        )}
        {messages.map((m) => {
          const day = dayKey(m.createdAt);
          const divider = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {divider && (
                <div className="my-3 flex items-center gap-3 text-xs font-medium text-subtle" role="separator">
                  <span className="h-px flex-1 bg-border" />
                  {dayLabel(m.createdAt)}
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <Message m={m} base={base} />
            </div>
          );
        })}
      </div>

      <div className="border-t border-border bg-surface-2/50 p-2 sm:p-3">
        {daily && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">
            <span className="font-medium">Daily update</span>
            <label className="flex items-center gap-2">
              How far along?
              <Select aria-label="How far along" value={percent} onChange={(e) => setPercent(e.target.value)} className="h-8 w-auto">
                <option value="">—</option>
                {PERCENTS.map((p) => <option key={p} value={p}>{p}%</option>)}
              </Select>
            </label>
            <button type="button" onClick={() => setDaily(false)} className="ml-auto text-xs underline">Not an update</button>
          </div>
        )}
        {photos.length > 0 && (
          <ul className="mb-2 flex gap-2 overflow-x-auto" aria-label="Photos to send">
            {photos.map((p) => (
              <li key={p.key} className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob URL) */}
                <img src={p.preview} alt="" className={cn("size-full object-cover", !p.id && "opacity-50")} />
                {!p.id && !p.error && <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-brand" aria-label="Uploading" />}
                {p.error && <span className="absolute inset-x-0 bottom-0 bg-danger px-1 text-[10px] text-white" title={p.error}>Failed</span>}
                <button
                  type="button"
                  onClick={() => setPhotos((list) => list.filter((x) => x.key !== p.key))}
                  aria-label="Remove photo"
                  className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-black/60 text-white"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <div className="mb-2"><FormError message={error} /></div>}
        <div className="flex items-end gap-1.5">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={() => cameraRef.current?.click()} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface sm:hidden" aria-label="Take a photo">
            <Camera className="size-5" aria-hidden />
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface" aria-label="Add photos">
            <ImagePlus className="size-5" aria-hidden />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={Math.min(5, Math.max(1, text.split("\n").length))}
            maxLength={4000}
            aria-label="Message"
            placeholder={daily ? "What got done today? Anything the office should know?" : "Message the job"}
            className="min-h-11 flex-1 resize-none rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-[15px] focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
          />
          <Button onClick={() => void send()} disabled={!canSend} className="h-11 shrink-0" aria-label={daily ? "Send daily update" : "Send"}>
            {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            <span className="hidden sm:inline">{daily ? "Send update" : "Send"}</span>
          </Button>
        </div>
        {!daily && (
          <button type="button" onClick={() => setDaily(true)} className="mt-1.5 text-xs font-medium text-brand hover:underline">
            Post today&apos;s daily update
          </button>
        )}
      </div>

      {peopleOpen && (
        <People
          members={props.members}
          candidates={props.candidates}
          canManage={props.canManage}
          onClose={() => setPeopleOpen(false)}
          add={props.addMember}
          remove={props.removeMember}
          refresh={() => router.refresh()}
        />
      )}
    </div>
  );
}

function Message({ m, base }: { m: MessageDTO; base: string }) {
  if (m.kind === "system") {
    return <p className="my-2 text-center text-xs text-muted">{m.body} · {timeOf(m.createdAt)}</p>;
  }
  const update = m.kind === "daily_update";
  return (
    <article className={cn("flex gap-2.5 rounded-lg px-1 py-1.5", update && "my-1 border border-brand/20 bg-brand-soft/40 px-2.5 py-2")} aria-label={`${m.authorName ?? "Someone"}, ${timeOf(m.createdAt)}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy text-xs font-semibold text-white" aria-hidden>{initials(m.authorName)}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold text-heading">{m.authorName ?? "Someone"}</span>
          <span className="text-xs text-subtle">{timeOf(m.createdAt)}</span>
          {update && <Badge tone="brand">Daily update{m.percentComplete != null ? ` · ${m.percentComplete}% done` : ""}</Badge>}
        </p>
        {update && m.percentComplete != null && (
          <div className="mt-1 h-1.5 w-full max-w-60 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={m.percentComplete} aria-valuemin={0} aria-valuemax={100} aria-label="How far along">
            <div className="h-full rounded-full bg-brand" style={{ width: `${m.percentComplete}%` }} />
          </div>
        )}
        {m.body && <p className="mt-0.5 text-[15px] whitespace-pre-wrap break-words">{m.body}</p>}
        {m.photos.length > 0 && (
          <ul className="mt-2 grid max-w-md grid-cols-3 gap-1.5" aria-label="Photos">
            {m.photos.map((p) => (
              <li key={p.id}>
                <a href={`${base}/photos/${p.id}`} target="_blank" rel="noopener" className="block aspect-square overflow-hidden rounded-lg border border-border bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private photos served by our own route */}
                  <img src={`${base}/photos/${p.id}?size=thumb`} alt="Job photo" loading="lazy" className="size-full object-cover" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function People({
  members,
  candidates,
  canManage,
  onClose,
  add,
  remove,
  refresh,
}: {
  members: ChannelMember[];
  candidates: { id: string; name: string; roleLabel: string }[];
  canManage: boolean;
  onClose: () => void;
  add: (userId: string) => Promise<Result>;
  remove: (userId: string) => Promise<Result>;
  refresh: () => void;
}) {
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) {
        setPick("");
        refresh();
      } else setError(r.error);
    });
  return (
    <Dialog open onClose={onClose} title="People in this chat" description="The owner and operations managers are in every job's chat. Anyone booked on the job joins it automatically." footer={<Button onClick={onClose}>Done</Button>}>
      <ul className="divide-y divide-border text-sm" aria-label="Members">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{m.name}</span>
              <span className="block text-xs text-muted">{m.roleLabel} · {WHY[m.why]}</span>
            </span>
            {canManage && m.removable && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => remove(m.id))}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && candidates.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block font-medium">Add someone</span>
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a person…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.roleLabel})</option>)}
            </Select>
          </label>
          <Button disabled={!pick || pending} onClick={() => run(() => add(pick))}>Add</Button>
        </div>
      )}
      {error && <div className="mt-3"><FormError message={error} /></div>}
    </Dialog>
  );
}

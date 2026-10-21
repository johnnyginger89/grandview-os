"use client";
import { Bell, BellRing } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  read: boolean;
}

type PushState = "unsupported" | "needs-home-screen" | "blocked" | "off" | "on" | "working";

const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentPushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return ios && !standalone ? "needs-home-screen" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** The bell: recent notices (estimate opened, accepted…) and switching phone notifications on for this device. */
export function NotificationsBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>("off");
  const [pushError, setPushError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    fetch("/api/notifications", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? (res.json() as Promise<{ items: Item[]; unread: number; vapidPublicKey: string }>) : null))
      .then((data) => {
        if (!data) return;
        setItems(data.items);
        setUnread(data.unread);
        setVapidKey(data.vapidPublicKey);
      })
      .catch(() => {
        // Offline for a moment: try again on the next tick.
      });
  }, []);

  // Check every minute while the page is visible, and whenever it comes back into view. The bell
  // sits in both the desktop and phone headers; only the one on screen checks.
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && buttonRef.current?.getClientRects().length && load();
    tick();
    const timer = window.setInterval(tick, 60_000);
    const desktop = window.matchMedia("(min-width: 64rem)");
    document.addEventListener("visibilitychange", tick);
    desktop.addEventListener("change", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      desktop.removeEventListener("change", tick);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    load();
    void currentPushState().then(setPushState);
    const onDown = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  const markRead = async (body: { ids: string[] } | { all: true }) => {
    setItems((list) => list.map((i) => ("all" in body || body.ids.includes(i.id) ? { ...i, read: true } : i)));
    setUnread((n) => ("all" in body ? 0 : Math.max(0, n - body.ids.length)));
    await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
  };

  const turnOn = async () => {
    setPushError(null);
    setPushState("working");
    try {
      if (!vapidKey) throw new Error("Not ready yet. Try again in a moment.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }));
      const res = await fetch("/api/notifications/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error("This device couldn't be set up. Try again.");
      setPushState("on");
    } catch (e) {
      setPushError(e instanceof Error ? e.message : "This device couldn't be set up. Try again.");
      setPushState("off");
    }
  };

  const turnOff = async () => {
    setPushState("working");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/notifications/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
    setPushState("off");
  };

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-10 place-items-center rounded-lg text-heading hover:bg-surface-2"
      >
        {unread ? <BellRing className="size-5" aria-hidden /> : <Bell className="size-5" aria-hidden />}
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-semibold text-white" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="group" aria-label="Notifications" className="absolute top-full right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold text-heading">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => void markRead({ all: true })} className="text-xs font-medium text-brand hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[min(60vh,26rem)] divide-y divide-border overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nothing new. Notices for you show up here.</li>}
            {items.map((n) => {
              const content = (
                <>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", n.read ? "text-text" : "font-semibold text-heading")}>{n.title}</span>
                    {n.body && <span className="block text-xs text-muted">{n.body}</span>}
                    <span className="block text-xs text-subtle">{timeAgo(n.createdAt)}</span>
                  </span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link
                      href={n.href}
                      onClick={() => {
                        if (!n.read) void markRead({ ids: [n.id] });
                        setOpen(false);
                      }}
                      className="flex gap-3 px-4 py-3 hover:bg-surface-2"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex gap-3 px-4 py-3">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border bg-surface-2/60 px-4 py-3 text-xs text-muted">
            {pushState === "on" && (
              <p className="flex items-center justify-between gap-2">
                Notifications are on for this device.
                <button type="button" onClick={() => void turnOff()} className="font-medium text-brand hover:underline">Turn off</button>
              </p>
            )}
            {(pushState === "off" || pushState === "working") && (
              <button type="button" disabled={pushState === "working"} onClick={() => void turnOn()} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-contrast hover:bg-brand-hover disabled:opacity-60">
                {pushState === "working" ? "Setting up…" : "Turn on notifications on this device"}
              </button>
            )}
            {pushState === "blocked" && <p>{"Notifications are blocked for this site. Allow them in your browser's site settings, then come back here."}</p>}
            {pushState === "needs-home-screen" && <p>On iPhone: tap Share, then “Add to Home Screen”, and open Grandview OS from your home screen to turn on notifications.</p>}
            {pushState === "unsupported" && <p>{"This browser can't show notifications. You'll still see them here."}</p>}
            {pushError && <p className="mt-1 text-danger" role="alert">{pushError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useRef } from "react";

const EVENTS = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;
/** Someone who leaves the page on screen this long is reading it, even without scrolling. */
const LOOKING_MS = 3_000;

/**
 * Tells the office the customer opened their proposal, but only once a person is looking:
 * link previews and email scanners fetch the page without running this, and headless
 * checkers rarely stay on screen or scroll.
 */
export function ViewBeacon({ record }: { record: () => Promise<void> }) {
  const sent = useRef(false);

  useEffect(() => {
    let timer: number | undefined;
    const send = () => {
      if (sent.current) return;
      sent.current = true;
      stop();
      record().catch(() => undefined);
    };
    const startTimer = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") timer = window.setTimeout(send, LOOKING_MS);
    };
    const stop = () => {
      window.clearTimeout(timer);
      for (const e of EVENTS) window.removeEventListener(e, send);
      document.removeEventListener("visibilitychange", startTimer);
    };
    if (sent.current) return;
    for (const e of EVENTS) window.addEventListener(e, send, { passive: true, once: true });
    document.addEventListener("visibilitychange", startTimer);
    startTimer();
    return stop;
  }, [record]);

  return null;
}

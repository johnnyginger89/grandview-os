"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { IsoDate } from "@/lib/calendar-date";
import { DRAG_THRESHOLD_PX } from "@/lib/schedule/drag";
import type { CellHit, DragSubject, DropPlan } from "./board-model";

/*
 * Drag, resize and create with Pointer Events (mouse, pen and touch alike).
 * idle → pressing → dragging → drop / cancel. Past the threshold the pressed element
 * captures the pointer; every move hit-tests the day cells under it ([data-cell],
 * with data-date and, on the timeline, data-crew) and asks the board for a plan.
 * Escape or pointercancel restores everything. The date math is in board-model.ts.
 */

const EDGE_PX = 40;
const SCROLL_STEP = 12;

export interface DragState {
  subject: DragSubject;
  /** Null while the pointer is outside the calendar. */
  plan: DropPlan | null;
}

interface Session {
  subject: DragSubject;
  pointerId: number;
  target: HTMLElement;
  originX: number;
  originY: number;
  x: number;
  y: number;
  dragging: boolean;
  grab: IsoDate | null;
  lastKey: string;
  plan: DropPlan | null;
  raf: number;
  end: () => void;
}

/** The day cell under a point. `data-crew=""` is the Unassigned row; no data-crew = month view. */
export function hitCell(x: number, y: number): CellHit | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof HTMLElement) || el.dataset.cell === undefined || !el.dataset.date) continue;
    const crew = el.dataset.crew;
    return { date: el.dataset.date, crewId: crew === undefined ? undefined : crew === "" ? null : crew };
  }
  return null;
}

export function useScheduleDrag({
  enabled,
  plan,
  onDrop,
  onCancel,
  scrollRef,
}: {
  enabled: boolean;
  plan: (subject: DragSubject, hit: CellHit, grab: IsoDate | null) => DropPlan;
  onDrop: (subject: DragSubject, plan: DropPlan) => void;
  onCancel?: () => void;
  /** The horizontally scrolling calendar, for edge auto-scroll. */
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const session = useRef<Session | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const suppressClick = useRef(false);
  // Latest callbacks without re-creating the listeners mid-drag.
  const cb = useRef({ plan, onDrop, onCancel });
  useEffect(() => {
    cb.current = { plan, onDrop, onCancel };
  });

  useEffect(() => () => session.current?.end(), []);

  const begin = useCallback(
    (e: ReactPointerEvent<HTMLElement>, subject: DragSubject) => {
      if (!enabled || session.current || e.button !== 0 || !e.isPrimary) return;
      const target = e.currentTarget;
      const s: Session = {
        subject,
        pointerId: e.pointerId,
        target,
        originX: e.clientX,
        originY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        dragging: false,
        grab: null,
        lastKey: "",
        plan: null,
        raf: 0,
        end: () => {},
      };

      const update = (force = false) => {
        const hit = hitCell(s.x, s.y);
        const key = hit ? `${hit.date}|${hit.crewId === undefined ? "-" : (hit.crewId ?? "")}` : "";
        if (!force && key === s.lastKey) return;
        s.lastKey = key;
        s.plan = hit ? cb.current.plan(s.subject, hit, s.grab) : null;
        setDrag({ subject: s.subject, plan: s.plan });
      };

      const placeFloating = () => {
        const f = floatingRef.current;
        if (f) f.style.transform = `translate(${s.x + 14}px, ${s.y + 14}px)`;
      };

      const tick = () => {
        if (!s.dragging) return;
        placeFloating();
        let scrolled = false;
        const box = scrollRef.current;
        if (box) {
          const r = box.getBoundingClientRect();
          const inside = s.y >= r.top && s.y <= r.bottom && s.x >= r.left && s.x <= r.right;
          if (inside && s.x < r.left + EDGE_PX && box.scrollLeft > 0) {
            box.scrollLeft -= SCROLL_STEP;
            scrolled = true;
          } else if (inside && s.x > r.right - EDGE_PX && box.scrollLeft + box.clientWidth < box.scrollWidth) {
            box.scrollLeft += SCROLL_STEP;
            scrolled = true;
          }
        }
        if (s.y < EDGE_PX && window.scrollY > 0) {
          window.scrollBy(0, -SCROLL_STEP);
          scrolled = true;
        } else if (s.y > window.innerHeight - EDGE_PX && window.scrollY + window.innerHeight < document.documentElement.scrollHeight) {
          window.scrollBy(0, SCROLL_STEP);
          scrolled = true;
        }
        if (scrolled) update();
        s.raf = requestAnimationFrame(tick);
      };

      const startDragging = () => {
        s.dragging = true;
        try {
          target.setPointerCapture(s.pointerId);
        } catch {
          // The pointer is already gone; pointerup/cancel will end the session.
        }
        // The day under the original press, so a move keeps the bar under the pointer.
        s.grab = hitCell(s.originX, s.originY)?.date ?? null;
        document.documentElement.style.userSelect = "none";
        update(true);
        s.raf = requestAnimationFrame(tick);
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== s.pointerId) return;
        s.x = ev.clientX;
        s.y = ev.clientY;
        if (!s.dragging) {
          if (Math.hypot(s.x - s.originX, s.y - s.originY) < DRAG_THRESHOLD_PX) return;
          startDragging();
        }
        ev.preventDefault();
        placeFloating();
        update();
      };

      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancelEvent);
        window.removeEventListener("keydown", onKey, true);
        cancelAnimationFrame(s.raf);
        if (s.dragging) {
          // The click that follows pointerup is dispatched before any timer runs.
          suppressClick.current = true;
          window.setTimeout(() => {
            suppressClick.current = false;
          }, 0);
          document.documentElement.style.userSelect = "";
          try {
            if (target.hasPointerCapture(s.pointerId)) target.releasePointerCapture(s.pointerId);
          } catch {
            // Already released.
          }
        }
        session.current = null;
        setDrag(null);
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== s.pointerId) return;
        const wasDragging = s.dragging;
        if (wasDragging) {
          s.x = ev.clientX;
          s.y = ev.clientY;
          update();
        }
        const dropped = s.plan;
        finish();
        if (!wasDragging) return;
        if (dropped && dropped.valid && dropped.changed) cb.current.onDrop(s.subject, dropped);
        else cb.current.onCancel?.();
      };

      const onCancelEvent = (ev: PointerEvent) => {
        if (ev.pointerId !== s.pointerId) return;
        const wasDragging = s.dragging;
        finish();
        if (wasDragging) cb.current.onCancel?.();
      };

      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape" || !s.dragging) return;
        ev.preventDefault();
        ev.stopPropagation();
        finish();
        cb.current.onCancel?.();
      };

      s.end = finish;
      session.current = s;
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancelEvent);
      window.addEventListener("keydown", onKey, true);
    },
    [enabled, scrollRef],
  );

  /** True right after a drag ended, so the click that follows doesn't open the drawer. */
  const consumeClick = useCallback(() => suppressClick.current, []);

  return { drag, begin, floatingRef, consumeClick };
}

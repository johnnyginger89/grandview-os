"use client";
import { Settings, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useSyncExternalStore, useTransition, type KeyboardEvent, type PointerEvent } from "react";
import { Dialog } from "@/components/dialog";
import { callAction } from "@/components/schedule/call-action";
import { EntryDrawer, type EntryDetails } from "@/components/schedule/entry-drawer";
import { EntryForm, type EntryFormValues } from "@/components/schedule/entry-form";
import { previewRangeText, warningsSummary } from "@/components/schedule/schedule-text";
import { LinkButton, PageHeader } from "@/components/ui";
import { addDays, type IsoDate } from "@/lib/calendar-date";
import { crewColorClasses } from "@/lib/schedule/colors";
import type { ScheduleEntryKind } from "@/lib/schedule/constants";
import { eachDay, maxIso, monthGrid } from "@/lib/schedule/dates";
import { dateRangeLabel, kindLabel, longDay, workingDaysLabel } from "@/lib/schedule/format";
import type { ScheduleSettings } from "@/lib/schedule/settings-schema";
import { allowedKinds } from "@/lib/schedule/status-plan";
import type { CrewDTO, EntryDTO, FinishCandidateDTO, ReadinessSummary, UnscheduledJobDTO } from "@/lib/schedule/types";
import type { ScheduleWindow } from "@/lib/schedule/window";
import { nextWorkingDay } from "@/lib/schedule/working-days";
import { cn } from "@/lib/utils";
import { createEntryAction, deleteEntryAction, markInProgressAction, splitEntryAction, updateEntryAction } from "./actions";
import { AgendaView } from "./agenda-view";
import {
  agendaDays,
  applyEntryOp,
  boardCalendars,
  crewRows,
  draftEntry,
  draftPlan,
  entriesOn,
  filterEntries,
  jobOf,
  keyboardStep,
  planDrop,
  suggestDays,
  windowConflicts,
  type DragSubject,
  type DropPlan,
  type KeyboardDraft,
  type KeyboardKey,
  type PlanContext,
} from "./board-model";
import { FinishList } from "./finish-list";
import { MonthView } from "./month-view";
import { ScheduleToolbar, type HrefFor } from "./schedule-toolbar";
import { TimelineView, type BarHandlers, type BoardPreview } from "./timeline-view";
import { UnscheduledSidebar } from "./unscheduled-sidebar";
import { useScheduleDrag } from "./use-schedule-drag";

export interface SchedulePerms {
  /** schedule.write: drag, forms, readiness. */
  canEdit: boolean;
  /** schedule.write + messages.send: start notices and confirmations. */
  canNotify: boolean;
  canOpenProject: boolean;
  canManage: boolean;
  /** projects.write: the "Finished?" list. */
  canComplete: boolean;
  /** schedule.write + projects.write. */
  canMarkInProgress: boolean;
}

type EntryPatch = Partial<Pick<EntryDTO, "crewId" | "kind" | "startDate" | "endDate" | "phaseLabel" | "notes" | "crewNotes">>;
type JobLike = ReturnType<typeof jobOf>;

interface CreateInput {
  projectId: string;
  crewId: string | null;
  kind: ScheduleEntryKind;
  startDate: IsoDate;
  endDate: IsoDate;
  phaseLabel?: string | null;
  notes?: string | null;
  crewNotes?: string | null;
}

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
  undo?: () => void;
  /** Month view: a booking dropped without a crew offers a crew picker. */
  assign?: EntryDTO;
}

const TOAST_MS = 8000;
const PHONE_QUERY = "(max-width: 767.98px)";
const KEYS: Record<string, KeyboardKey> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const PATCH_KEYS = ["crewId", "kind", "startDate", "endDate", "phaseLabel", "notes", "crewNotes"] as const;

/** null while rendering on the server and hydrating: CSS decides until then. */
function useIsPhone(): boolean | null {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE_QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => null,
  );
}

/**
 * /schedule: toolbar, the To-schedule sidebar, the crew timeline or month grid
 * (desktop and tablet) or the agenda (phones), the booking drawer and toasts.
 * Every change is optimistic, chained per booking so quick successive moves use the
 * newest version, and comes with Undo. The page re-renders with fresh data in the
 * same response as each action (revalidatePath), so the board never fetches itself.
 */
export function ScheduleBoard({
  win,
  today,
  settings,
  crews,
  entries,
  readiness,
  unscheduled,
  finish,
  hoursPerCrewDay,
  focus,
  perms,
}: {
  win: ScheduleWindow;
  today: IsoDate;
  settings: ScheduleSettings;
  crews: CrewDTO[];
  entries: EntryDTO[];
  readiness: Record<string, ReadinessSummary>;
  unscheduled: UnscheduledJobDTO[];
  finish: FinishCandidateDTO[];
  hoursPerCrewDay: string;
  focus: EntryDetails | null;
  perms: SchedulePerms;
}) {
  const router = useRouter();
  const isPhone = useIsPhone();
  const [filter, setFilter] = useState<string[]>(win.crews);
  const [search, setSearch] = useState("");
  const [drawerId, setDrawerId] = useState<string | null>(focus?.entryId ?? null);
  const [scheduling, setScheduling] = useState<UnscheduledJobDTO | null>(null);
  const [dayOpen, setDayOpen] = useState<IsoDate | null>(null);
  const [phoneTab, setPhoneTab] = useState<"agenda" | "todo">("agenda");
  const [kbd, setKbd] = useState<{ entry: EntryDTO; draft: KeyboardDraft } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isPending, startTransition] = useTransition();
  const [navPending, startNav] = useTransition();
  const [optimistic, addOp] = useOptimistic(entries, applyEntryOp);

  const versions = useRef(new Map<string, number>());
  const chains = useRef(new Map<string, Promise<unknown>>());
  const latestEntries = useRef(entries);
  const tempSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initialFocus = useRef(focus?.entryId ?? null);

  useEffect(() => {
    latestEntries.current = entries;
  }, [entries]);

  const crewsById = useMemo(() => new Map(crews.map((c) => [c.id, c])), [crews]);
  const { closed, calFor } = useMemo(() => boardCalendars(settings, win.from, win.to), [settings, win.from, win.to]);
  const calForCrewId = (id: string | null) => calFor(id ? crewsById.get(id) : null);
  const fallback = useMemo(() => ({ crewSize: settings.defaultCrewSize, hoursPerDay: hoursPerCrewDay }), [settings.defaultCrewSize, hoursPerCrewDay]);
  const rows = useMemo(() => crewRows(crews, filter), [crews, filter]);
  const visible = useMemo(() => filterEntries(optimistic, filter), [optimistic, filter]);
  const conflicts = useMemo(() => windowConflicts(optimistic, crewsById, calFor), [optimistic, crewsById, calFor]);
  const monthCrewId = filter.length ? (rows.find((r) => r.crewId && r.droppable)?.crewId ?? null) : null;
  const planCtx: PlanContext = { crewsById, calFor, entries: optimistic, fallback, monthCrewId };
  const crewName = (id: string | null) => (id ? (crewsById.get(id)?.name ?? "a crew") : "Unassigned");

  // ---------------------------------------------------------------------------
  // URL state: view/from/span reload from the server (links); the crew filter and
  // the open booking are kept in the address bar without a round trip.
  // ---------------------------------------------------------------------------
  const hrefFor: HrefFor = (o = {}) => {
    const p = new URLSearchParams();
    const view = o.view ?? win.view;
    p.set("view", view);
    p.set("from", o.from ?? (win.view === "month" && view === "month" ? (win.month ?? win.from) : win.from));
    if (view === "timeline") p.set("span", String(o.span ?? win.span));
    const c = o.crews ?? filter;
    if (c.length) p.set("crews", c.join(","));
    if (o.focus) p.set("focus", o.focus);
    return `/schedule?${p.toString().replace(/%2C/g, ",")}`;
  };
  const focusParam = drawerId && !drawerId.startsWith("temp-") ? drawerId : "";
  const currentUrl = hrefFor({ focus: focusParam });
  useEffect(() => {
    // Only touch the address bar when the crew filter or the open booking differ from it.
    const params = new URLSearchParams(window.location.search);
    if ((params.get("crews") ?? "") === filter.join(",") && (params.get("focus") ?? "") === focusParam) return;
    window.history.replaceState(null, "", currentUrl);
  }, [currentUrl, filter, focusParam, win.focus]);

  useEffect(() => {
    if (initialFocus.current) document.querySelector(`[data-entry-id="${initialFocus.current}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.assign ? TOAST_MS * 2 : TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  function announce(message: string) {
    setAnnouncement(message);
  }
  // The toast is itself a polite live region (role="status"), so it isn't announced twice.
  function showToast(message: string, extra: Partial<Pick<Toast, "undo" | "assign">> = {}) {
    setToast((t) => ({ id: (t?.id ?? 0) + 1, message, tone: "info", ...extra }));
  }
  function showError(message: string) {
    setToast((t) => ({ id: (t?.id ?? 0) + 1, message, tone: "error" }));
  }

  // ---------------------------------------------------------------------------
  // Writes: optimistic, chained per booking, with Undo.
  // ---------------------------------------------------------------------------
  function latestVersion(id: string): number {
    const fromProps = latestEntries.current.find((e) => e.id === id)?.version ?? 0;
    return Math.max(versions.current.get(id) ?? 0, fromProps);
  }

  function enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prev = chains.current.get(id) ?? Promise.resolve();
    const run = prev.then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    chains.current.set(id, tail);
    void tail.then(() => {
      if (chains.current.get(id) === tail) chains.current.delete(id);
    });
    return run;
  }

  function runUpdate(entry: EntryDTO, patch: EntryPatch, describe: (e: EntryDTO) => string, undoable = true, after?: (e: EntryDTO) => void) {
    const keys = PATCH_KEYS.filter((k) => patch[k] !== undefined);
    if (!keys.length) return;
    const before = Object.fromEntries(keys.map((k) => [k, entry[k]])) as EntryPatch;
    const shown: Partial<EntryDTO> = { ...patch, ...(patch.crewId !== undefined ? { crewName: patch.crewId ? crewName(patch.crewId) : null } : {}) };
    startTransition(async () => {
      addOp({ type: "update", id: entry.id, patch: shown });
      const r = await enqueue(entry.id, () => callAction(() => updateEntryAction({ id: entry.id, version: latestVersion(entry.id), ...patch })));
      if (!r.ok) {
        showError(r.error);
        return;
      }
      versions.current.set(entry.id, r.entry.version);
      const message = `${describe(r.entry)} ${warningsSummary(r.warnings)}`.trim();
      showToast(message, undoable ? { undo: () => runUpdate(r.entry, before, (e) => `Undone: #${e.projectNumber} is back to ${dateRangeLabel(e.startDate, e.endDate)}, ${e.crewName ?? "Unassigned"}.`, false) } : {});
      after?.(r.entry);
    });
  }

  /** A keyboard move can put the bar in another row, which loses focus; put it back. */
  function focusBar(id: string) {
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-entry-id="${id}"] > button`)?.focus(), 0);
  }

  function runCreate(job: JobLike, input: CreateInput, describe: (e: EntryDTO) => string, opts: { undoable?: boolean; offerCrew?: boolean } = {}) {
    const tempId = `temp-${++tempSeq.current}`;
    startTransition(async () => {
      addOp({ type: "create", entry: draftEntry(tempId, job, { ...input, crewName: input.crewId ? crewName(input.crewId) : null }) });
      const payload = { ...input, allowNonWorkingStart: true };
      let r = await callAction(() => createEntryAction(payload));
      if (!r.ok && r.reason === "confirm_on_hold") {
        if (!window.confirm(`#${job.number} is on hold. Schedule it and move it to Scheduled?`)) {
          announce(`#${job.number} was not scheduled.`);
          return;
        }
        r = await callAction(() => createEntryAction({ ...payload, confirmOnHold: true }));
      }
      if (!r.ok) {
        showError(r.error);
        return;
      }
      const created = r.entry;
      versions.current.set(created.id, created.version);
      const message = `${describe(created)} ${warningsSummary(r.warnings)}`.trim();
      showToast(message, {
        undo: opts.undoable === false ? undefined : () => runDelete(created, { undoable: false, message: `Undone: #${created.projectNumber} is off the schedule again.` }),
        assign: opts.offerCrew && !created.crewId ? created : undefined,
      });
    });
  }

  function runDelete(entry: EntryDTO, opts: { undoable?: boolean; message?: string } = {}) {
    startTransition(async () => {
      addOp({ type: "delete", id: entry.id });
      const r = await enqueue(entry.id, () => callAction(() => deleteEntryAction({ id: entry.id, version: latestVersion(entry.id) })));
      if (!r.ok) {
        showError(r.error);
        return;
      }
      const message = opts.message ?? `Removed #${entry.projectNumber} (${dateRangeLabel(entry.startDate, entry.endDate)}) from the schedule.`;
      showToast(
        message,
        opts.undoable === false
          ? {}
          : {
              undo: () =>
                runCreate(
                  jobOf(entry),
                  { projectId: entry.projectId, crewId: entry.crewId, kind: entry.kind, startDate: entry.startDate, endDate: entry.endDate, phaseLabel: entry.phaseLabel, notes: entry.notes, crewNotes: entry.crewNotes },
                  (e) => `Undone: #${e.projectNumber} is back on the schedule.`,
                  { undoable: false },
                ),
            },
      );
    });
  }

  function runSplit(entry: EntryDTO, firstPartEnd: IsoDate) {
    const originalEnd = entry.endDate;
    startTransition(async () => {
      addOp({ type: "update", id: entry.id, patch: { endDate: firstPartEnd } });
      const r = await enqueue(entry.id, () => callAction(() => splitEntryAction({ id: entry.id, version: latestVersion(entry.id), firstPartEnd })));
      if (!r.ok) {
        showError(r.error);
        return;
      }
      const [a, b] = r.entries;
      versions.current.set(a.id, a.version);
      versions.current.set(b.id, b.version);
      showToast(`Split #${a.projectNumber}: ${dateRangeLabel(a.startDate, a.endDate)} and ${dateRangeLabel(b.startDate, b.endDate)}.`, {
        undo: () =>
          startTransition(async () => {
            addOp({ type: "delete", id: b.id });
            addOp({ type: "update", id: a.id, patch: { endDate: originalEnd } });
            const d = await enqueue(b.id, () => callAction(() => deleteEntryAction({ id: b.id, version: latestVersion(b.id) })));
            if (!d.ok) {
              showError(d.error);
              return;
            }
            const u = await enqueue(a.id, () => callAction(() => updateEntryAction({ id: a.id, version: latestVersion(a.id), endDate: originalEnd })));
            if (!u.ok) {
              showError(u.error);
              return;
            }
            versions.current.set(a.id, u.entry.version);
            showToast(`Undone: #${a.projectNumber} is one booking again (${dateRangeLabel(u.entry.startDate, u.entry.endDate)}).`);
          }),
      });
    });
  }

  function commitPlan(entry: EntryDTO, plan: DropPlan, mode: "move" | "resize-start" | "resize-end", after?: (e: EntryDTO) => void) {
    const patch: EntryPatch = {};
    if (plan.startDate !== entry.startDate) patch.startDate = plan.startDate;
    if (plan.endDate !== entry.endDate) patch.endDate = plan.endDate;
    if (plan.crewId !== entry.crewId) patch.crewId = plan.crewId;
    runUpdate(entry, patch, (e) =>
      mode === "move"
        ? `Moved #${e.projectNumber} to ${e.crewName ?? "Unassigned"}, ${dateRangeLabel(e.startDate, e.endDate)}.`
        : `#${e.projectNumber} is now ${dateRangeLabel(e.startDate, e.endDate)} (${workingDaysLabel(plan.workingDays)}).`,
      true,
      after,
    );
  }

  function createFromPlan(job: UnscheduledJobDTO, plan: DropPlan) {
    runCreate(
      job,
      { projectId: job.projectId, crewId: plan.crewId, kind: "work", startDate: plan.startDate, endDate: plan.endDate },
      (e) => `Scheduled #${e.projectNumber} with ${e.crewName ?? "no crew yet"}, ${dateRangeLabel(e.startDate, e.endDate)}.`,
      { offerCrew: win.view === "month" },
    );
  }

  // ---------------------------------------------------------------------------
  // Drag (pointer) and keyboard move mode
  // ---------------------------------------------------------------------------
  const { drag, begin, floatingRef, consumeClick } = useScheduleDrag({
    enabled: perms.canEdit && isPhone !== true,
    plan: (subject, hit, grab) => planDrop(subject, hit, grab, planCtx),
    onDrop: (subject: DragSubject, plan: DropPlan) => {
      if (subject.kind === "job") createFromPlan(subject.job, plan);
      else commitPlan(subject.entry, plan, subject.mode);
    },
    onCancel: () => announce("Nothing changed."),
    scrollRef,
  });

  const kbdPlan = kbd ? draftPlan(kbd.entry, kbd.draft, planCtx) : null;
  const preview: BoardPreview | null = drag?.plan
    ? { entryId: drag.subject.kind === "entry" ? drag.subject.entry.id : null, plan: drag.plan }
    : kbd && kbdPlan
      ? { entryId: kbd.entry.id, plan: kbdPlan }
      : null;

  function openDrawer(entry: EntryDTO) {
    if (consumeClick()) return;
    setKbd(null);
    setDrawerId(entry.id);
    if (entry.id.startsWith("temp-")) return;
    startNav(() => router.replace(hrefFor({ focus: entry.id }), { scroll: false }));
  }

  function openOther(entry: EntryDTO) {
    if (optimistic.some((e) => e.id === entry.id)) {
      openDrawer(entry);
      return;
    }
    // Outside the visible weeks: jump to that booking's week.
    setDrawerId(entry.id);
    startNav(() => router.push(hrefFor({ view: "timeline", from: entry.startDate, focus: entry.id }), { scroll: false }));
  }

  function onBarKeyDown(e: KeyboardEvent<HTMLButtonElement>, entry: EntryDTO) {
    if (!perms.canEdit || entry.id.startsWith("temp-")) return;
    const active = kbd && kbd.entry.id === entry.id ? kbd : null;
    if (!active) {
      if (e.key === "m" || e.key === "M" || e.key === " ") {
        e.preventDefault();
        setKbd({ entry, draft: { startDate: entry.startDate, endDate: entry.endDate, crewId: entry.crewId } });
        announce(
          `Moving job ${entry.projectNumber}. Left and right arrows move it one work day. Shift with an arrow changes the end date, Alt with an arrow changes the start date. Up and down change the crew. Enter saves, Escape cancels.`,
        );
      }
      return;
    }
    const key = KEYS[e.key];
    if (key) {
      e.preventDefault();
      const next = keyboardStep(active.draft, key, { shift: e.shiftKey, alt: e.altKey }, { rows, crewsById, calFor });
      setKbd({ entry, draft: next });
      const p = draftPlan(entry, next, planCtx);
      announce(`${dateRangeLabel(next.startDate, next.endDate)}, ${crewName(next.crewId)}, ${workingDaysLabel(p.workingDays)}${p.conflict ? ", double-booked" : ""}${p.valid ? "" : `, ${p.reason}`}.`);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setKbd(null);
      const p = draftPlan(entry, active.draft, planCtx);
      if (!p.changed) announce("Nothing changed.");
      else if (!p.valid) showError(p.reason ?? "That move isn't possible.");
      else {
        commitPlan(entry, p, "move", (saved) => focusBar(saved.id));
        focusBar(entry.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setKbd(null);
      announce("Move cancelled.");
    } else if (e.key === " ") {
      e.preventDefault();
    }
  }

  function onBarBlur(entry: EntryDTO) {
    if (kbd?.entry.id === entry.id) {
      setKbd(null);
      announce("Move cancelled.");
    }
  }

  const handlers: BarHandlers = {
    onOpen: openDrawer,
    onPointerDown: (e: PointerEvent<HTMLElement>, entry: EntryDTO, mode) => {
      setKbd(null);
      begin(e, { kind: "entry", entry, mode });
    },
    onKeyDown: onBarKeyDown,
    onBlur: onBarBlur,
  };

  // ---------------------------------------------------------------------------
  // Drawer callbacks
  // ---------------------------------------------------------------------------
  const drawerEntry = drawerId ? (optimistic.find((e) => e.id === drawerId) ?? focus?.project.entries.find((e) => e.id === drawerId) ?? null) : null;
  const details = focus && focus.entryId === drawerId ? focus : null;

  function saveFromDrawer(entry: EntryDTO, v: EntryFormValues) {
    const patch: EntryPatch = {};
    if (v.crewId !== entry.crewId) patch.crewId = v.crewId;
    if (v.kind !== entry.kind) patch.kind = v.kind;
    if (v.startDate !== entry.startDate) patch.startDate = v.startDate;
    if (v.endDate !== entry.endDate) patch.endDate = v.endDate;
    if (v.phaseLabel !== entry.phaseLabel) patch.phaseLabel = v.phaseLabel;
    if (v.crewNotes !== entry.crewNotes) patch.crewNotes = v.crewNotes;
    if (v.notes !== entry.notes) patch.notes = v.notes;
    if (!Object.keys(patch).length) {
      showToast("Nothing to save – no changes.");
      return;
    }
    runUpdate(entry, patch, (e) => `Saved #${e.projectNumber}: ${dateRangeLabel(e.startDate, e.endDate)}, ${e.crewName ?? "Unassigned"}.`);
  }

  function addPhase(entry: EntryDTO, v: EntryFormValues) {
    runCreate(
      jobOf(entry),
      { projectId: entry.projectId, crewId: v.crewId, kind: v.kind, startDate: v.startDate, endDate: v.endDate, phaseLabel: v.phaseLabel, notes: v.notes, crewNotes: v.crewNotes },
      (e) => `Added ${kindLabel(e.kind).toLowerCase()} for #${e.projectNumber}: ${dateRangeLabel(e.startDate, e.endDate)}, ${e.crewName ?? "Unassigned"}.`,
    );
  }

  function markInProgress(projectId: string) {
    startTransition(async () => {
      const r = await callAction(() => markInProgressAction({ projectId }));
      if (!r.ok) showError(r.error);
      else showToast(r.message ?? "Marked in progress");
    });
  }

  function scheduleFromSheet(job: UnscheduledJobDTO, v: EntryFormValues) {
    setScheduling(null);
    runCreate(
      job,
      { projectId: job.projectId, crewId: v.crewId, kind: v.kind, startDate: v.startDate, endDate: v.endDate, phaseLabel: v.phaseLabel, notes: v.notes, crewNotes: v.crewNotes },
      (e) => `Scheduled #${e.projectNumber} with ${e.crewName ?? "no crew yet"}, ${dateRangeLabel(e.startDate, e.endDate)}.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const days = useMemo(() => eachDay(win.from, win.to), [win.from, win.to]);
  const grid = useMemo(() => (win.month ? monthGrid(Number(win.month.slice(0, 4)), Number(win.month.slice(5, 7)), settings.weekStartsOn) : null), [win.month, settings.weekStartsOn]);
  const agendaFrom = today >= win.from && today <= win.to ? maxIso(win.from, today) : win.from;
  const agenda = useMemo(
    () => (isPhone === false ? [] : agendaDays(visible, agendaFrom, win.to, closed, (e) => calFor(e.crewId ? crewsById.get(e.crewId) : null))),
    [isPhone, visible, agendaFrom, win.to, closed, calFor, crewsById],
  );
  const toScheduleCount = unscheduled.filter((j) => j.group === "need_to_schedule").length;
  const draggingJob = drag?.subject.kind === "job" ? drag.subject.job : null;
  const firstCrew = rows.find((r) => r.crewId && r.droppable)?.crewId ?? null;

  const sidebar = (draggable: boolean) => (
    <>
      {perms.canComplete && <FinishList items={finish} onDone={(m) => showToast(m)} />}
      <UnscheduledSidebar
        jobs={unscheduled}
        search={search}
        today={today}
        fallback={fallback}
        canEdit={perms.canEdit}
        draggable={draggable && perms.canEdit}
        draggingProjectId={draggingJob?.projectId ?? null}
        onSchedule={setScheduling}
        onDragStart={(e, job) => begin(e, { kind: "job", job })}
      />
    </>
  );

  return (
    <div data-testid="schedule-board" data-layout={isPhone === null ? "pending" : isPhone ? "phone" : "desktop"}>
      <PageHeader
        title="Schedule"
        description={
          perms.canEdit
            ? "Drag a job onto a crew and day, or use Schedule… on the job. Click a booking to change it."
            : "Every crew's bookings at a glance. You can view the schedule but not change it."
        }
        actions={
          perms.canManage ? (
            <LinkButton href="/schedule/setup" variant="secondary" size="sm">
              <Settings className="size-4" aria-hidden /> Setup
            </LinkButton>
          ) : undefined
        }
      />
      <ScheduleToolbar win={win} today={today} hrefFor={hrefFor} crews={crews} filter={filter} onFilter={setFilter} search={search} onSearch={setSearch} loading={navPending} />

      {isPhone !== true && (
        <div className={cn("gap-4 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start", isPhone === null && "hidden md:block lg:grid")}>
          <aside aria-label="Jobs to schedule" data-print-hide className="mb-4 space-y-3 print:hidden lg:sticky lg:top-4 lg:mb-0 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:pr-1">
            <h2 className="text-sm font-semibold">To schedule</h2>
            {sidebar(true)}
          </aside>
          <div className="min-w-0">
            {win.view === "month" && grid ? (
              <MonthView
                grid={grid}
                month={win.month ?? win.from}
                today={today}
                entries={visible}
                closed={closed}
                calFor={calFor}
                crewsById={crewsById}
                conflicts={conflicts}
                readiness={readiness}
                search={search}
                editable={perms.canEdit}
                preview={preview}
                handlers={handlers}
                onShowDay={setDayOpen}
              />
            ) : (
              <TimelineView
                from={win.from}
                days={days}
                today={today}
                weekStartsOn={settings.weekStartsOn}
                rows={rows}
                entries={visible}
                closed={closed}
                calFor={calFor}
                crewsById={crewsById}
                conflicts={conflicts}
                readiness={readiness}
                search={search}
                editable={perms.canEdit}
                preview={preview}
                scrollRef={scrollRef}
                handlers={handlers}
              />
            )}
            <Legend canEdit={perms.canEdit} />
          </div>
        </div>
      )}

      {isPhone !== false && (
        <div className={cn(isPhone === null && "md:hidden")}>
          <div role="tablist" aria-label="Schedule" className="mb-3 grid grid-cols-2 rounded-md border border-border-strong bg-surface p-0.5 text-sm">
            {(
              [
                ["agenda", "Agenda"],
                ["todo", `To schedule (${toScheduleCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={phoneTab === key}
                onClick={() => setPhoneTab(key)}
                className={cn("rounded px-3 py-2 font-medium", phoneTab === key ? "bg-brand text-brand-contrast" : "text-muted")}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={phoneTab === "agenda" ? "Agenda" : "To schedule"} className="space-y-3">
            {phoneTab === "agenda" ? (
              <AgendaView days={agenda} today={today} crewsById={crewsById} conflicts={conflicts} search={search} onOpen={openDrawer} />
            ) : (
              sidebar(false)
            )}
          </div>
        </div>
      )}

      {draggingJob && (
        <div ref={floatingRef} aria-hidden className="pointer-events-none fixed top-0 left-0 z-50 max-w-72 rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-xl" style={{ transform: "translate(-9999px, -9999px)" }}>
          <p className="font-semibold">
            #{draggingJob.number} · {draggingJob.customerName}
          </p>
          <p className={cn("text-xs", drag?.plan && (drag.plan.conflict || !drag.plan.valid) ? "text-danger" : "text-muted")}>
            {drag?.plan
              ? `${crewName(drag.plan.crewId)} · ${previewRangeText(drag.plan.startDate, drag.plan.endDate, drag.plan.workingDays)}${!drag.plan.valid ? ` · ${drag.plan.reason}` : drag.plan.conflict ? " · double-booked" : ""}`
              : "Drop it on a crew and day"}
          </p>
        </div>
      )}

      <EntryDrawer
        open={!!drawerEntry}
        onClose={() => setDrawerId(null)}
        entry={drawerEntry}
        crews={crews}
        details={details}
        calendarFor={calForCrewId}
        suggestDays={(crewId, remaining) => suggestDays({ remainingHours: remaining ?? "0" }, crewId ? crewsById.get(crewId) : null, fallback)}
        today={today}
        perms={{ canEdit: perms.canEdit, canNotify: perms.canNotify, canOpenProject: perms.canOpenProject, canMarkInProgress: perms.canMarkInProgress }}
        pending={isPending}
        onSave={saveFromDrawer}
        onSplit={runSplit}
        onDelete={(e) => {
          setDrawerId(null);
          runDelete(e);
        }}
        onAddPhase={addPhase}
        onOpenEntry={openOther}
        onMarkInProgress={markInProgress}
        onMessage={(m) => showToast(m)}
      />

      <Dialog
        open={!!scheduling}
        onClose={() => setScheduling(null)}
        title={scheduling ? `Schedule #${scheduling.number} · ${scheduling.customerName}` : "Schedule"}
        description={scheduling ? `${scheduling.jobTitle}${scheduling.city ? ` · ${scheduling.city}` : ""}` : undefined}
        className="m-0 h-dvh max-h-dvh w-screen max-w-none rounded-none border-0 md:m-auto md:h-auto md:max-h-[90dvh] md:w-[min(36rem,calc(100vw-2rem))] md:rounded-lg md:border"
      >
        {scheduling && (
          <div data-testid="schedule-sheet">
            <EntryForm
              mode="create"
              crews={crews}
              initial={{ crewId: firstCrew, kind: "work", startDate: nextWorkingDay(addDays(today, 1), calForCrewId(firstCrew)) }}
              kinds={allowedKinds(scheduling.status)}
              calendarFor={calForCrewId}
              suggestDays={(crewId) => suggestDays(scheduling, crewId ? crewsById.get(crewId) : null, fallback)}
              submitLabel="Save"
              pending={isPending}
              onSubmit={(v) => scheduleFromSheet(scheduling, v)}
              onCancel={() => setScheduling(null)}
            />
          </div>
        )}
      </Dialog>

      <Dialog open={!!dayOpen} onClose={() => setDayOpen(null)} title={dayOpen ? longDay(dayOpen) : ""}>
        {dayOpen && (
          <ul className="space-y-1.5" aria-label="Bookings on this day">
            {entriesOn(visible, dayOpen).map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => {
                    setDayOpen(null);
                    openDrawer(e);
                  }}
                >
                  <span className={cn("size-2.5 shrink-0 rounded-full", crewColorClasses(e.crewId ? crewsById.get(e.crewId)?.color : null).dot)} aria-hidden />
                  <span className="font-semibold">#{e.projectNumber}</span>
                  <span className="min-w-0 flex-1 truncate">{e.customerName}</span>
                  <span className="text-xs text-muted">{e.crewName ?? "Unassigned"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <p aria-live="polite" className="sr-only" data-testid="schedule-live">
        {announcement}
      </p>
      <div role="status" className="pointer-events-none fixed right-4 bottom-[calc(var(--app-bottom)+5rem)] z-50 print:hidden" data-testid="schedule-toast">
        {toast && (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg sm:max-w-xl",
              toast.tone === "error" ? "bg-danger" : "bg-navy",
            )}
          >
            <span className="min-w-0 flex-1">{toast.message}</span>
            {toast.assign && (
              <label className="flex items-center gap-1.5">
                <span className="sr-only">Assign crew</span>
                <select
                  aria-label="Assign crew"
                  className="h-8 rounded border border-white/40 bg-transparent px-2 text-sm text-white"
                  defaultValue=""
                  onChange={(ev) => {
                    const id = ev.target.value;
                    const created = toast.assign;
                    if (!id || !created) return;
                    setToast(null);
                    runUpdate(created, { crewId: id }, (e) => `#${e.projectNumber} assigned to ${e.crewName ?? "a crew"}.`);
                  }}
                >
                  <option value="" className="text-text">Assign crew…</option>
                  {crews
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id} className="text-text">
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {toast.undo && (
              <button
                type="button"
                className="rounded px-1 font-semibold underline underline-offset-2 hover:no-underline"
                onClick={() => {
                  const undo = toast.undo;
                  setToast(null);
                  undo?.();
                }}
              >
                Undo
              </button>
            )}
            <button type="button" aria-label="Dismiss" className="-mr-1 rounded p-1 text-white/80 hover:text-white" onClick={() => setToast(null)}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted print:hidden">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm border border-dashed border-border-strong" style={{ backgroundImage: "repeating-linear-gradient(135deg, rgb(0 0 0 / 0.12) 0 3px, transparent 3px 6px)" }} aria-hidden />
        Tentative (start date not confirmed)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm border-l-4 border-l-slate-500 bg-slate-100" aria-hidden />
        Confirmed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm ring-2 ring-danger" aria-hidden />
        Double-booked
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm bg-surface-2" aria-hidden />
        Weekend
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm bg-warning-soft" aria-hidden />
        Holiday or closed
      </span>
      {canEdit && <span>Keyboard: focus a booking and press M, then use the arrow keys and Enter.</span>}
    </div>
  );
}

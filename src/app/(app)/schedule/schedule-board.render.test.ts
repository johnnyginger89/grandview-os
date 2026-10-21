/**
 * Server-renders the board with fixture data (no database, no browser) to check the
 * markup e2e tests rely on, and that read-only users get no drag handles or send
 * buttons. Interactions are covered by tests/e2e.
 */
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultScheduleSettings } from "@/lib/schedule/settings-schema";
import type { CrewDTO, EntryDTO, FinishCandidateDTO, ProjectScheduleDTO, UnscheduledJobDTO } from "@/lib/schedule/types";
import { resolveWindow } from "@/lib/schedule/window";
import { windowQuerySchema } from "@/lib/schedule/schemas";

vi.mock("./actions", () => {
  const fail = async () => ({ ok: false, error: "not in tests" });
  return {
    createEntryAction: fail,
    updateEntryAction: fail,
    deleteEntryAction: fail,
    splitEntryAction: fail,
    setReadinessAction: fail,
    saveSchedulingPrefsAction: fail,
    markInProgressAction: fail,
    completeFromScheduleAction: fail,
    previewStartNoticeAction: fail,
    sendStartNoticeAction: fail,
    markStartConfirmedAction: fail,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: (props: { href: string; children: ReactNode; scroll?: boolean; prefetch?: boolean }) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest.children;
    delete rest.scroll;
    delete rest.prefetch;
    return createElement("a", rest, props.children);
  },
}));

const { ScheduleBoard } = await import("./schedule-board");

const settings = defaultScheduleSettings();
const today = "2026-10-21";

const crew = (id: string, name: string, over: Partial<CrewDTO> = {}): CrewDTO => ({
  id,
  name,
  kind: "in_house",
  trade: "painting",
  subCompany: null,
  color: "emerald",
  crewSize: 3,
  hoursPerDay: "8.00",
  worksSaturdays: false,
  active: true,
  sortOrder: 0,
  memberCount: 2,
  ...over,
});
const NIKO = "11111111-1111-4111-8111-111111111111";
const TIA = "22222222-2222-4222-8222-222222222222";
const crews = [crew(NIKO, "[TEST DATA] Niko"), crew(TIA, "[TEST DATA] Tia", { color: "violet", sortOrder: 1 })];

const entry = (id: string, over: Partial<EntryDTO> = {}): EntryDTO => ({
  id,
  version: 1,
  projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  projectNumber: 3012,
  jobTitle: "Exterior repaint",
  jobType: "exterior",
  customerName: "[TEST DATA] Lee",
  city: "Surrey",
  projectStatus: "scheduled",
  confirmation: "week_sent",
  communicatedStart: "2026-10-19",
  crewId: NIKO,
  crewName: "[TEST DATA] Niko",
  kind: "work",
  phaseLabel: null,
  startDate: "2026-10-19",
  endDate: "2026-10-23",
  plannedHours: null,
  notes: "Gate code in office notes",
  crewNotes: "Park on the street",
  ...over,
});
const E1 = "33333333-3333-4333-8333-333333333333";
const E2 = "44444444-4444-4444-8444-444444444444";
const entries = [
  entry(E1),
  entry(E2, { projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", projectNumber: 3015, customerName: "[TEST DATA] Kim", startDate: "2026-10-22", endDate: "2026-10-26", confirmation: "date_confirmed" }),
];

const job: UnscheduledJobDTO = {
  projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  number: 3018,
  jobTitle: "Exterior repaint",
  customerName: "[TEST DATA] Park",
  city: "White Rock",
  jobType: "exterior",
  soldAt: "2026-10-03T19:00:00.000Z",
  status: "need_to_schedule",
  estimatedHours: "42.00",
  scheduledHours: "0.00",
  remainingHours: "42.00",
  notBefore: null,
  readiness: { total: 4, ready: 2, missing: ["Colours & paint", "Deposit received"] },
  group: "need_to_schedule",
};
const finish: FinishCandidateDTO[] = [{ projectId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", number: 3001, jobTitle: "Interior repaint", customerName: "[TEST DATA] Wu", status: "in_progress", lastWorkDay: "2026-10-16" }];

const project: ProjectScheduleDTO = {
  projectId: entries[0].projectId,
  projectNumber: 3012,
  projectStatus: "scheduled",
  entries: [entries[0]],
  scheduling: {
    projectId: entries[0].projectId,
    confirmation: "week_sent",
    noticeVariant: "exterior",
    weekSentAt: "2026-10-10T17:00:00.000Z",
    weekConfirmedAt: null,
    dateSentAt: null,
    dateConfirmedAt: null,
    confirmedVia: null,
    communicatedStart: "2026-10-19",
    communicatedEnd: "2026-10-23",
    notBefore: null,
    schedulingNotes: null,
    version: 2,
  },
  readiness: [
    { key: "deposit", label: "Deposit received", states: { todo: "Not yet", in_progress: "Invoice sent", done: "Received", not_needed: "Not required" }, linkedEntryKind: null, state: "todo", stateLabel: "Not yet", dueDate: null, note: null },
  ],
  readinessSummary: { total: 1, ready: 0, pct: 0, missing: ["Deposit received"] },
  hours: { estimated: "120.00", scheduled: "120.00" },
  firstWorkDay: "2026-10-19",
  lastWorkDay: "2026-10-23",
};

const all = { canEdit: true, canNotify: true, canOpenProject: true, canManage: true, canComplete: true, canMarkInProgress: true };
const readOnly = { canEdit: false, canNotify: false, canOpenProject: false, canManage: false, canComplete: false, canMarkInProgress: false };

function render(opts: { view?: "timeline" | "month"; perms?: typeof all; focus?: boolean } = {}) {
  const win = resolveWindow(windowQuerySchema.parse({ view: opts.view ?? "timeline", from: "2026-10-12", span: "14" }), settings, today);
  // React separates adjacent text nodes with <!-- --> in server HTML; the browser shows one string.
  return renderToString(
    createElement(ScheduleBoard, {
      win,
      today,
      settings,
      crews,
      entries,
      readiness: {},
      unscheduled: [job],
      finish,
      hoursPerCrewDay: "8",
      focus: opts.focus ? { entryId: E1, project, warnings: [{ type: "double_booked", crewName: "[TEST DATA] Niko", dates: ["2026-10-22"], otherProjectNumbers: [3015] }] } : null,
      perms: opts.perms ?? all,
    }),
  ).replace(/<!-- -->/g, "");
}

describe("ScheduleBoard (server render)", () => {
  it("renders crew rows, shaded holidays, bars and the sidebar for editors", () => {
    const html = render();
    expect(html).toContain('data-testid="schedule-timeline"');
    expect(html).toContain('data-crew-name="[TEST DATA] Niko"');
    expect(html).toContain('data-crew-row="unassigned"');
    expect(html).toMatch(/data-testid="day-header" data-date="2026-10-12" title="Thanksgiving Day – BC statutory holiday"/);
    expect(html).toMatch(/aria-label="Job #3012, \[TEST DATA\] Lee, painting, \[TEST DATA\] Niko, Monday, October 19 to Friday, October 23, 5 working days, tentative, double-booked"/);
    expect(html).toContain('aria-label="Drag #3012 to move it"');
    expect(html).toContain('aria-label="Change end date"');
    expect(html).toContain('aria-label="Drag #3018 onto the calendar"');
    expect(html).toContain("→ 2 days");
    expect(html).toContain('data-testid="finish-list"');
    expect(html).toContain("Mark complete");
    expect(html).toContain('href="/schedule/setup"');
    // Two weeks: Thanksgiving (Mon Oct 12) is not a work day, so 9 are available.
    expect(html).toMatch(/\[TEST DATA\] Niko: 5 of 9 work days booked/);
  });

  it("gives read-only users no drag handles, no Schedule… and no Finished list", () => {
    const html = render({ perms: readOnly });
    expect(html).not.toContain("aria-label=\"Drag #");
    expect(html).not.toContain("Change end date");
    expect(html).not.toContain("Schedule…");
    expect(html).not.toContain('data-testid="finish-list"');
    expect(html).toContain("→ 2 days");
    expect(html).not.toContain("42 h");
  });

  it("renders the month grid", () => {
    const html = render({ view: "month" });
    expect(html).toContain('data-testid="schedule-month"');
    expect(html).toContain('data-date="2026-10-01"');
    expect(html).toContain("Thanksgiving");
  });

  it("opens the drawer for ?focus= with warnings, readiness and the customer block", () => {
    const html = render({ focus: true });
    expect(html).toContain('data-testid="entry-drawer"');
    expect(html).toContain("Double-booked: [TEST DATA] Niko also has #3015 on Thu, Oct 22.");
    expect(html).toContain('data-testid="readiness-summary"');
    expect(html).toContain('data-testid="confirmation-chip"');
    expect(html).toContain("Start week sent");
    expect(html).toContain("Mark week confirmed");
    expect(html).toContain("Send start date…");
    expect(html).toContain("Scheduled 120 h of 120 h estimated");
    expect(html).toContain("Remove from schedule");
  });

  it("keeps the drawer read-only for estimators", () => {
    const html = render({ focus: true, perms: readOnly });
    expect(html).toContain('data-testid="entry-drawer"');
    expect(html).not.toContain("Send start week");
    expect(html).not.toContain("Mark week confirmed");
    expect(html).not.toContain("Remove from schedule");
  });
});

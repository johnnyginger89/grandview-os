/**
 * Schedule enums with no dependencies, so client components can import them
 * without pulling in the database schema. `src/db/schema/schedule.ts` re-exports them.
 */

export const CREW_KINDS = ["in_house", "subcontractor"] as const;
export type CrewKind = (typeof CREW_KINDS)[number];

export const CREW_TRADES = ["painting", "pressure_washing", "carpentry", "drywall", "colour_consulting", "other"] as const;
export type CrewTrade = (typeof CREW_TRADES)[number];

/** Palette keys only (validated by zod); mapped to static Tailwind classes in ./colors.ts. */
export const CREW_COLORS = ["emerald", "violet", "amber", "sky", "rose", "indigo", "orange", "teal", "lime", "fuchsia", "cyan", "slate"] as const;
export type CrewColor = (typeof CREW_COLORS)[number];

export const SCHEDULE_ENTRY_KINDS = ["work", "pressure_wash", "colour_consult", "carpentry", "walk_through", "touch_up", "other"] as const;
export type ScheduleEntryKind = (typeof SCHEDULE_ENTRY_KINDS)[number];

export const START_CONFIRMATIONS = ["none", "week_sent", "week_confirmed", "date_sent", "date_confirmed"] as const;
export type StartConfirmation = (typeof START_CONFIRMATIONS)[number];

export const CONFIRM_VIA = ["email", "phone", "text", "in_person"] as const;
export type ConfirmVia = (typeof CONFIRM_VIA)[number];

export const NOTICE_VARIANTS = ["interior", "exterior"] as const;
export type NoticeVariant = (typeof NOTICE_VARIANTS)[number];

export const NOTICE_KINDS = ["start_week", "start_date"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
/** Only email today; SMS is a seam (spec-schedule §0.1). */
export type NoticeChannel = "email" | "sms";

export const READINESS_STATES = ["todo", "in_progress", "done", "not_needed"] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

/** DB check `sched_dates_chk`: end − start ≤ 180 days. */
export const MAX_BOOKING_SPAN_DAYS = 180;
/** Largest working-day count a form or suggestion may produce. */
export const MAX_WORKING_DAYS = 120;
/** getScheduleWindow refuses wider windows. */
export const MAX_WINDOW_DAYS = 62;

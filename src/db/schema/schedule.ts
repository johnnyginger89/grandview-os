import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ConfirmVia, CrewColor, CrewKind, CrewTrade, NoticeVariant, ReadinessState, ScheduleEntryKind, StartConfirmation } from "../../lib/schedule/constants";
import { user } from "./auth";
import { projects } from "./projects";

export {
  CONFIRM_VIA,
  CREW_COLORS,
  CREW_KINDS,
  CREW_TRADES,
  READINESS_STATES,
  SCHEDULE_ENTRY_KINDS,
  START_CONFIRMATIONS,
  type ConfirmVia,
  type CrewColor,
  type CrewKind,
  type CrewTrade,
  type ReadinessState,
  type ScheduleEntryKind,
  type StartConfirmation,
} from "../../lib/schedule/constants";

const ts = (name: string) => timestamp(name, { withTimezone: true });
/** 'YYYY-MM-DD', a Vancouver calendar day (never an instant). */
const day = (name: string) => date(name, { mode: "string" });

/** A schedulable resource: an in-house crew or a subcontractor (paid per job). */
export const crews = pgTable(
  "crews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind").$type<CrewKind>().notNull().default("in_house"),
    trade: text("trade").$type<CrewTrade>().notNull().default("painting"),
    /** Subcontractor's business name. */
    subCompany: text("sub_company"),
    /** No DB check so the palette can grow without a migration; zod validates it. */
    color: text("color").$type<CrewColor>().notNull().default("sky"),
    /** Capacity = crew_size × hours_per_day, used for suggested durations. */
    crewSize: integer("crew_size").notNull().default(3),
    hoursPerDay: numeric("hours_per_day", { precision: 4, scale: 2 }).notNull().default("8"),
    worksSaturdays: boolean("works_saturdays").notNull().default(false),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    /** e.g. "monday:status4:0" for a future import. */
    externalRef: text("external_ref"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("crews_name_idx").on(sql`lower(${t.name})`),
    index("crews_active_idx").on(t.active, t.sortOrder),
    check("crews_kind_chk", sql`${t.kind} IN ('in_house','subcontractor')`),
    check("crews_size_chk", sql`${t.crewSize} BETWEEN 1 AND 50`),
    check("crews_hours_chk", sql`${t.hoursPerDay} > 0 AND ${t.hoursPerDay} <= 24`),
  ],
);

/** Which logins belong to a crew. Membership decides what a field user sees on /my-jobs. */
export const crewMembers = pgTable(
  "crew_members",
  {
    crewId: uuid("crew_id")
      .notNull()
      .references(() => crews.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The lead sees the customer's phone on /my-jobs. */
    isLead: boolean("is_lead").notNull().default(false),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.crewId, t.userId] }),
    index("crew_members_user_idx").on(t.userId),
    uniqueIndex("crew_members_one_lead_idx").on(t.crewId).where(sql`is_lead`),
  ],
);

/**
 * One bar on the calendar. A project can have many (phases, buildings, crews, PW,
 * walk-through, touch-ups). Only src/server/schedule.ts writes this table.
 */
export const scheduleEntries = pgTable(
  "schedule_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Null = on the "Unassigned" row. */
    crewId: uuid("crew_id").references(() => crews.id, { onDelete: "restrict" }),
    kind: text("kind").$type<ScheduleEntryKind>().notNull().default("work"),
    phaseLabel: text("phase_label"),
    startDate: day("start_date").notNull(),
    /** Inclusive. Google Calendar's all-day end is exclusive: the sync adds one day. */
    endDate: day("end_date").notNull(),
    /** Optional override when a crew is split across jobs; otherwise working days × crew capacity. */
    plannedHours: numeric("planned_hours", { precision: 8, scale: 2 }),
    /** Internal (PM/office). Never shown to field roles. */
    notes: text("notes"),
    /** Shown to the assigned crew on /my-jobs. */
    crewNotes: text("crew_notes"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    /** Soft delete so calendar sync can remove mirrored events. */
    deletedAt: ts("deleted_at"),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("sched_project_idx").on(t.projectId).where(sql`deleted_at IS NULL`),
    index("sched_crew_range_idx").on(t.crewId, t.startDate, t.endDate).where(sql`deleted_at IS NULL`),
    index("sched_range_idx").on(t.startDate, t.endDate).where(sql`deleted_at IS NULL`),
    index("sched_updated_idx").on(t.updatedAt),
    check("sched_dates_chk", sql`${t.endDate} >= ${t.startDate} AND ${t.endDate} - ${t.startDate} <= 180`),
    check("sched_kind_chk", sql`${t.kind} IN ('work','pressure_wash','colour_consult','walk_through','touch_up')`),
  ],
);

/** 1:1 with projects; a missing row means all defaults. Holds the customer start-date workflow. */
export const projectScheduling = pgTable(
  "project_scheduling",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    confirmation: text("confirmation").$type<StartConfirmation>().notNull().default("none"),
    noticeVariant: text("notice_variant").$type<NoticeVariant>(),
    weekSentAt: ts("week_sent_at"),
    weekConfirmedAt: ts("week_confirmed_at"),
    dateSentAt: ts("date_sent_at"),
    dateConfirmedAt: ts("date_confirmed_at"),
    confirmedVia: text("confirmed_via").$type<ConfirmVia>(),
    /** What the customer was last told (drives "send an update" when the schedule moves). */
    communicatedStart: day("communicated_start"),
    communicatedEnd: day("communicated_end"),
    /** "Next spring" and similar: do not schedule before this day. */
    notBefore: day("not_before"),
    schedulingNotes: text("scheduling_notes"),
    version: integer("version").notNull().default(1),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("psched_conf_chk", sql`${t.confirmation} IN ('none','week_sent','week_confirmed','date_sent','date_confirmed')`),
    check("psched_variant_chk", sql`${t.noticeVariant} IS NULL OR ${t.noticeVariant} IN ('interior','exterior')`),
    check("psched_via_chk", sql`${t.confirmedVia} IS NULL OR ${t.confirmedVia} IN ('email','phone','text','in_person')`),
    index("psched_not_before_idx").on(t.notBefore),
  ],
);

/** Answers to the readiness checks (keys come from the `schedule` setting). Missing row = "todo". */
export const projectReadiness = pgTable(
  "project_readiness",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    checkKey: text("check_key").notNull(),
    state: text("state").$type<ReadinessState>().notNull().default("todo"),
    dueDate: day("due_date"),
    note: text("note"),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.checkKey] }),
    check("readiness_state_chk", sql`${t.state} IN ('todo','in_progress','done','not_needed')`),
  ],
);

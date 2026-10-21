import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects, type ProjectStatus } from "./projects";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const STATUS_EVENT_SOURCES = ["app", "backfill", "import"] as const;
export type StatusEventSource = (typeof STATUS_EVENT_SOURCES)[number];

/** Append-only history of project status changes (powers Produced/Backlog history and the project timeline). */
export const projectStatusEvents = pgTable(
  "project_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** Null for the first event of a project. */
    fromStatus: text("from_status").$type<ProjectStatus>(),
    toStatus: text("to_status").$type<ProjectStatus>().notNull(),
    /** When the change took effect for reporting (a back-dated finish date lands here). */
    effectiveAt: ts("effective_at").notNull(),
    changedAt: ts("changed_at").notNull().defaultNow(),
    changedBy: text("changed_by").references(() => user.id, { onDelete: "set null" }),
    source: text("source").$type<StatusEventSource>().notNull().default("app"),
    note: text("note"),
  },
  (t) => [index("pse_project_idx").on(t.projectId, t.changedAt), index("pse_to_status_idx").on(t.toStatus, t.effectiveAt)],
);

import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects } from "./projects";
import { crews } from "./schedule";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const WORK_ORDER_STATUSES = ["draft", "issued", "cancelled"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export interface WorkOrderChecklistItem {
  id: string;
  text: string;
}

/** A per-project, crew-safe work order. Issuing freezes a version in work_order_versions. */
export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Shown as "WO-7001". */
    number: integer("number").generatedAlwaysAsIdentity({ startWith: 7001 }),
    title: text("title").notNull(),
    status: text("status").$type<WorkOrderStatus>().notNull().default("draft"),
    /** 0 = never issued. */
    currentVersion: integer("current_version").notNull().default(0),
    // Plain text; "- " lines become bullets, as in the proposal prose.
    specialInstructions: text("special_instructions"),
    equipment: text("equipment"),
    safetyNotes: text("safety_notes"),
    /** Overrides properties.access_notes when set. */
    accessNotes: text("access_notes"),
    showCustomerPhone: boolean("show_customer_phone").notNull().default(false),
    checklist: jsonb("checklist").$type<WorkOrderChecklistItem[]>().notNull().default([]),
    /** Null = the whole project (all crews). */
    crewId: uuid("crew_id").references(() => crews.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("work_orders_project_idx").on(t.projectId),
    index("work_orders_crew_idx").on(t.crewId),
    uniqueIndex("work_orders_number_idx").on(t.number),
    check("work_orders_status_chk", sql`${t.status} IN ('draft','issued','cancelled')`),
    check("work_orders_version_chk", sql`${t.currentVersion} >= 0`),
  ],
);

/** Frozen, crew-safe snapshots (WorkOrderView from src/server/work-order-view.ts). */
export const workOrderVersions = pgTable(
  "work_order_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    view: jsonb("view").notNull(),
    changeNote: text("change_note"),
    issuedBy: text("issued_by").references(() => user.id, { onDelete: "set null" }),
    issuedAt: ts("issued_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("work_order_versions_idx").on(t.workOrderId, t.version), check("work_order_versions_version_chk", sql`${t.version} >= 1`)],
);

/**
 * Share links for crews without a login. Only sha256(token) is stored, so a link
 * can't be read back from the database; the raw token is shown once at creation.
 */
export const workOrderLinks = pgTable(
  "work_order_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    /** sha256(token), hex. */
    tokenHash: text("token_hash").notNull(),
    label: text("label").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    openCount: integer("open_count").notNull().default(0),
    lastOpenedAt: ts("last_opened_at"),
    lastOpenedVersion: integer("last_opened_version"),
  },
  (t) => [uniqueIndex("work_order_links_token_idx").on(t.tokenHash), index("work_order_links_wo_idx").on(t.workOrderId)],
);

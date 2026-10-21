import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { customers, opportunities, properties } from "./crm";
import { estimates } from "./estimating";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const PROPOSAL_STATUSES = ["sent", "viewed", "accepted", "declined", "superseded", "withdrawn"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** What the customer received and signed. Immutable once accepted. */
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    estimateId: uuid("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    token: text("token").notNull(),
    status: text("status").$type<ProposalStatus>().notNull().default("sent"),
    /** Full estimate document at send time (internal; never sent to the browser). */
    snapshot: jsonb("snapshot").notNull(),
    /** Customer-facing view: no costs, margins or internal notes. */
    view: jsonb("view").notNull(),
    message: text("message"),
    sentTo: text("sent_to"),
    sentBy: text("sent_by").references(() => user.id),
    sentAt: ts("sent_at").notNull().defaultNow(),
    expiresAt: ts("expires_at"),
    firstViewedAt: ts("first_viewed_at"),
    lastViewedAt: ts("last_viewed_at"),
    viewCount: integer("view_count").notNull().default(0),
    acceptedAt: ts("accepted_at"),
    acceptedName: text("accepted_name"),
    acceptedEmail: text("accepted_email"),
    signature: text("signature"),
    acceptedIp: text("accepted_ip"),
    acceptedUserAgent: text("accepted_user_agent"),
    selectedOptionIds: text("selected_option_ids").array(),
    acceptedTotals: jsonb("accepted_totals").$type<Record<string, string>>(),
    documentHash: text("document_hash"),
    acceptedMessage: text("accepted_message"),
    /** Insurance documents current when the customer signed. */
    acceptedDocumentIds: uuid("accepted_document_ids").array(),
    declinedAt: ts("declined_at"),
    declineReason: text("decline_reason"),
  },
  (t) => [uniqueIndex("proposals_token_idx").on(t.token), index("proposals_estimate_idx").on(t.estimateId)],
);

export const PROJECT_STATUSES = ["need_to_schedule", "scheduled", "in_progress", "walk_through", "complete", "invoiced", "closed", "on_hold", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").generatedAlwaysAsIdentity({ startWith: 3001 }),
    name: text("name").notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").references(() => properties.id, { onDelete: "set null" }),
    estimateId: uuid("estimate_id").references(() => estimates.id, { onDelete: "set null" }),
    proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    status: text("status").$type<ProjectStatus>().notNull().default("need_to_schedule"),
    contractPrice: money("contract_price").notNull(),
    contractTotal: money("contract_total").notNull(),
    depositRequired: money("deposit_required").notNull().default("0"),
    estimatedHours: numeric("estimated_hours", { precision: 14, scale: 4 }).notNull().default("0"),
    estimatedCost: money("estimated_cost").notNull().default("0"),
    projectManagerId: text("project_manager_id").references(() => user.id),
    startDate: ts("start_date"),
    endDate: ts("end_date"),
    notes: text("notes"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    /** When the customer signed. Set from the proposal's acceptedAt; the default covers rows inserted by code deployed before this column. */
    soldAt: ts("sold_at").notNull().defaultNow(),
    /** "Finish date": first move into complete/invoiced/closed. Editable; cleared if the job is reopened. Drives "Produced". */
    completedAt: ts("completed_at"),
    /** When a cancellation took effect; cleared if the job is reinstated. */
    cancelledAt: ts("cancelled_at"),
  },
  (t) => [
    index("projects_status_idx").on(t.status),
    uniqueIndex("projects_estimate_idx").on(t.estimateId),
    index("projects_sold_idx").on(t.soldAt),
    index("projects_completed_idx").on(t.completedAt),
  ],
);

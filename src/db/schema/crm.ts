import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const created = () => ts("created_at").notNull().defaultNow();
const updated = () => ts("updated_at").notNull().defaultNow();

export const CUSTOMER_TYPES = ["residential", "commercial", "strata"] as const;
export const ORG_TYPES = ["strata_management", "strata_corporation", "property_management", "commercial", "other"] as const;
export const PROPERTY_TYPES = ["detached", "townhouse", "condo", "strata_complex", "commercial", "other"] as const;

/** Strata management companies, strata corporations, commercial clients. */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").$type<(typeof ORG_TYPES)[number]>().notNull().default("other"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  notes: text("notes"),
  createdAt: created(),
  updatedAt: updated(),
});

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").$type<(typeof CUSTOMER_TYPES)[number]>().notNull().default("residential"),
    displayName: text("display_name").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    email: text("email"),
    phone: text("phone"),
    source: text("source"),
    tags: text("tags").array().notNull().default([]),
    notes: text("notes"),
    customFields: jsonb("custom_fields").$type<Record<string, string>>().notNull().default({}),
    qboCustomerId: text("qbo_customer_id"),
    importSource: text("import_source"),
    importRef: text("import_ref"),
    archivedAt: ts("archived_at"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("customers_name_idx").on(t.displayName), index("customers_email_idx").on(t.email)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    phone2: text("phone2"),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("contacts_customer_idx").on(t.customerId), index("contacts_email_idx").on(t.email)],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    label: text("label"),
    street: text("street").notNull(),
    unit: text("unit"),
    city: text("city"),
    province: text("province").notNull().default("BC"),
    postalCode: text("postal_code"),
    propertyType: text("property_type").$type<(typeof PROPERTY_TYPES)[number]>(),
    builtBefore1990: boolean("built_before_1990"),
    strataPlan: text("strata_plan"),
    accessNotes: text("access_notes"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("properties_customer_idx").on(t.customerId)],
);

export const STAGE_KINDS = ["open", "won", "lost"] as const;

/** Customizable sales pipeline. */
export const pipelineStages = pgTable("pipeline_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  kind: text("kind").$type<(typeof STAGE_KINDS)[number]>().notNull().default("open"),
  color: text("color").notNull().default("slate"),
  /** Days in this stage before the card is flagged as going stale. */
  staleAfterDays: integer("stale_after_days"),
});

export const LEAD_CHANNELS = ["youcanbookme", "website_form", "phone", "email", "facebook", "instagram", "referral", "other"] as const;

/** A sales opportunity: from first inquiry to won/lost. */
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").generatedAlwaysAsIdentity({ startWith: 1001 }),
    title: text("title").notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").references(() => properties.id, { onDelete: "set null" }),
    stageId: uuid("stage_id").notNull().references(() => pipelineStages.id),
    stageChangedAt: ts("stage_changed_at").notNull().defaultNow(),
    source: text("source"),
    channel: text("channel").$type<(typeof LEAD_CHANNELS)[number]>(),
    projectTypes: text("project_types").array().notNull().default([]),
    description: text("description"),
    timeline: text("timeline"),
    temperature: text("temperature"),
    estimatedValue: numeric("estimated_value", { precision: 14, scale: 2 }),
    estimatorId: text("estimator_id").references(() => user.id),
    setterId: text("setter_id").references(() => user.id),
    estimateVisitAt: ts("estimate_visit_at"),
    bookingRef: text("booking_ref"),
    bookingManageUrl: text("booking_manage_url"),
    firstViewedAt: ts("first_viewed_at"),
    lastContactedAt: ts("last_contacted_at"),
    nextFollowUpAt: ts("next_follow_up_at"),
    lostReason: text("lost_reason"),
    wonAt: ts("won_at"),
    closedAt: ts("closed_at"),
    externalSource: text("external_source"),
    externalRef: text("external_ref"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("opp_stage_idx").on(t.stageId),
    index("opp_customer_idx").on(t.customerId),
    uniqueIndex("opp_external_idx").on(t.externalSource, t.externalRef),
  ],
);

export const ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "sms",
  "stage_change",
  "booking",
  "estimate",
  "system",
] as const;

/** Timeline of everything that happened with a customer. */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
    type: text("type").$type<(typeof ACTIVITY_TYPES)[number]>().notNull(),
    body: text("body").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").references(() => user.id),
    createdAt: created(),
  },
  (t) => [index("activities_customer_idx").on(t.customerId, t.createdAt), index("activities_opp_idx").on(t.opportunityId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    notes: text("notes"),
    dueAt: ts("due_at"),
    assigneeId: text("assignee_id").references(() => user.id),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
    completedAt: ts("completed_at"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: created(),
  },
  (t) => [index("tasks_assignee_idx").on(t.assigneeId, t.completedAt)],
);

export const messageTemplates = pgTable("message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  channel: text("channel").$type<"email" | "sms">().notNull().default("email"),
  subject: text("subject"),
  body: text("body").notNull(),
  updatedAt: updated(),
});

export const MESSAGE_STATUSES = ["queued", "sent", "failed", "logged"] as const;

/** Every customer-facing message, whether sent by a provider or only logged in development. */
export const outboundMessages = pgTable("outbound_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").$type<"email" | "sms">().notNull(),
  toAddress: text("to_address").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status").$type<(typeof MESSAGE_STATUSES)[number]>().notNull().default("queued"),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  templateKey: text("template_key"),
  sentBy: text("sent_by").references(() => user.id),
  createdAt: created(),
  sentAt: ts("sent_at"),
});

/** Raw inbound webhook payloads (YouCanBook.me, website forms), kept for audit and replay. */
export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    externalRef: text("external_ref"),
    payload: jsonb("payload").notNull(),
    status: text("status").$type<"received" | "processed" | "failed" | "duplicate">().notNull().default("received"),
    error: text("error"),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    receivedAt: created(),
    processedAt: ts("processed_at"),
  },
  (t) => [index("inbound_source_ref_idx").on(t.source, t.externalRef)],
);

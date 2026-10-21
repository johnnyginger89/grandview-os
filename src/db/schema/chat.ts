import { sql } from "drizzle-orm";
import { boolean, check, customType, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects } from "./projects";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const JOB_MESSAGE_KINDS = ["message", "daily_update", "system"] as const;
export type JobMessageKind = (typeof JOB_MESSAGE_KINDS)[number];

/**
 * One job's channel: messages, end-of-day updates from the crew and notes the app posts
 * itself (colours signed, work order issued). Only src/server/job-chat.ts writes these tables.
 */
export const jobMessages = pgTable(
  "job_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Null for system messages and for people since deleted. */
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").$type<JobMessageKind>().notNull().default("message"),
    body: text("body").notNull().default(""),
    /** Daily updates: how far along the job is, 0–100. */
    percentComplete: integer("percent_complete"),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("job_messages_project_idx").on(t.projectId, t.createdAt),
    check("job_messages_kind_chk", sql`${t.kind} IN ('message','daily_update','system')`),
    check("job_messages_percent_chk", sql`${t.percentComplete} IS NULL OR ${t.percentComplete} BETWEEN 0 AND 100`),
  ],
);

/**
 * Photos posted in a job's channel. Kept private (they show the inside of customers'
 * homes): served only to people in the channel, unlike public proposal pictures.
 */
export const jobPhotos = pgTable(
  "job_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Null until the message it was uploaded for is posted. */
    messageId: uuid("message_id").references(() => jobMessages.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    data: bytea("data").notNull(),
    /** A small copy for the message list. */
    thumb: bytea("thumb").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("job_photos_message_idx").on(t.messageId),
    index("job_photos_project_idx").on(t.projectId, t.createdAt),
    check("job_photos_type_chk", sql`${t.contentType} IN ('image/jpeg','image/png','image/webp')`),
    check("job_photos_size_chk", sql`${t.byteSize} <= 3145728`),
  ],
);

/**
 * People added to a channel by hand, and where everyone has read up to. The owner and
 * operations managers are always in every channel and crews booked on the job are in
 * its channel; neither needs a row except to remember what they've read.
 */
export const jobChannelMembers = pgTable(
  "job_channel_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Added by hand (a painter, the colour consultant, a carpenter…). */
    manual: boolean("manual").notNull().default(false),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    addedAt: ts("added_at"),
    lastReadAt: ts("last_read_at"),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("job_channel_members_user_idx").on(t.userId)],
);

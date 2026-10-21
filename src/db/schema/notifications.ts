import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** One notice for one person: shown under the bell, and pushed to their phone if they allowed it. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** e.g. proposal.viewed, proposal.accepted, proposal.declined. */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Where tapping it goes, always a path inside the app. */
    href: text("href"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    readAt: ts("read_at"),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt), index("notifications_entity_idx").on(t.entityType, t.entityId)],
);

/** A browser or phone that agreed to receive push notifications (Web Push). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSuccessAt: ts("last_success_at"),
    failureCount: integer("failure_count").notNull().default(0),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);

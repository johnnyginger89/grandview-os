import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const INTEGRATION_PROVIDERS = ["companycam"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];
export const LINKED_ENTITY_TYPES = ["project", "estimate"] as const;
export type LinkedEntityType = (typeof LINKED_ENTITY_TYPES)[number];

/** A job or estimate here linked to its record in another service (a CompanyCam project). */
export const integrationLinks = pgTable(
  "integration_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
    entityType: text("entity_type").$type<LinkedEntityType>().notNull(),
    entityId: uuid("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    /** The other service's name for it, e.g. the CompanyCam project's name. */
    externalName: text("external_name"),
    linkedBy: text("linked_by").references(() => user.id, { onDelete: "set null" }),
    linkedAt: ts("linked_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("integration_links_entity_idx").on(t.provider, t.entityType, t.entityId),
    check("integration_links_provider_chk", sql`${t.provider} IN ('companycam')`),
    check("integration_links_entity_chk", sql`${t.entityType} IN ('project','estimate')`),
  ],
);

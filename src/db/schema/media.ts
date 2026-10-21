import { sql } from "drizzle-orm";
import { check, customType, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const MEDIA_KINDS = ["image", "document"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const IMAGE_PURPOSES = ["proposal_image"] as const;
export const DOCUMENT_PURPOSES = ["insurance_certificate", "worksafebc_clearance"] as const;
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];
export type MediaPurpose = (typeof IMAGE_PURPOSES)[number] | DocumentPurpose;

/**
 * Owner uploads (proposal pictures, insurance documents), stored in Postgres so they
 * are served from our own origin. Rows are immutable once ready: a replacement is a new row.
 */
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<MediaKind>().notNull(),
    purpose: text("purpose").$type<MediaPurpose>().notNull(),
    status: text("status").$type<"pending" | "ready">().notNull().default("pending"),
    contentType: text("content_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    partsReceived: integer("parts_received").notNull().default(0),
    byteSize: integer("byte_size").notNull().default(0),
    data: bytea("data").notNull().default(sql`'\\x'::bytea`),
    sha256: text("sha256"),
    originalFilename: text("original_filename").notNull(),
    title: text("title"),
    alt: text("alt"),
    width: integer("width"),
    height: integer("height"),
    /** Calendar dates printed on the document, not instants. */
    effectiveOn: date("effective_on", { mode: "string" }),
    expiresOn: date("expires_on", { mode: "string" }),
    archivedAt: ts("archived_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    readyAt: ts("ready_at"),
  },
  (t) => [
    check("media_kind_chk", sql`${t.kind} IN ('image','document')`),
    check("media_status_chk", sql`${t.status} IN ('pending','ready')`),
    check(
      "media_type_chk",
      sql`(${t.kind} = 'image' AND ${t.contentType} IN ('image/jpeg','image/png','image/webp')) OR (${t.kind} = 'document' AND ${t.contentType} IN ('application/pdf','image/jpeg','image/png'))`,
    ),
    check("media_size_chk", sql`${t.byteSize} <= CASE WHEN ${t.kind} = 'image' THEN 3145728 ELSE 10485760 END`),
    index("media_purpose_idx").on(t.purpose, t.status, t.archivedAt, t.createdAt),
    uniqueIndex("media_purpose_sha_idx").on(t.purpose, t.sha256).where(sql`status = 'ready'`),
  ],
);

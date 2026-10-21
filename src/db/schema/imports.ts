import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { customers } from "./crm";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const IMPORT_STATUSES = ["preview", "imported", "rolled_back"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * One uploaded file. It stays a preview until the owner presses Import; an imported
 * batch can be undone, which removes what it created and restores what it filled in.
 */
export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  kind: text("kind").notNull().default("customers"),
  filename: text("filename").notNull(),
  status: text("status").$type<ImportStatus>().notNull().default("preview"),
  headers: jsonb("headers").$type<string[]>().notNull().default([]),
  mapping: jsonb("mapping").$type<string[]>().notNull().default([]),
  rowCount: integer("row_count").notNull().default(0),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  createdBy: text("created_by").references(() => user.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  importedAt: ts("imported_at"),
  importedBy: text("imported_by").references(() => user.id),
  rolledBackAt: ts("rolled_back_at"),
  rolledBackBy: text("rolled_back_by").references(() => user.id),
});

/** Raw rows of the file (for the preview) and, after import, what each one did. */
export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    cells: jsonb("cells").$type<string[]>().notNull(),
    action: text("action").$type<"create" | "merge" | "skip">(),
    message: text("message"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    customerCreated: boolean("customer_created").notNull().default(false),
    createdContactIds: jsonb("created_contact_ids").$type<string[]>().notNull().default([]),
    createdPropertyIds: jsonb("created_property_ids").$type<string[]>().notNull().default([]),
    /** Customer fields a merge filled in (old and new value), so undo can restore them if unchanged since. */
    filledBefore: jsonb("filled_before").$type<Record<string, { before: string | null; after: string }>>(),
  },
  (t) => [index("import_rows_batch_idx").on(t.batchId, t.rowNumber), index("import_rows_customer_idx").on(t.customerId)],
);

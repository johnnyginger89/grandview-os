import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { customers } from "./crm";
import { projects } from "./projects";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const COLOUR_SELECTION_STATUSES = ["draft", "sent", "signed", "replaced", "cancelled"] as const;
export type ColourSelectionStatus = (typeof COLOUR_SELECTION_STATUSES)[number];
export const COLOUR_SIGNED_VIA = ["link", "device"] as const;
export type ColourSignedVia = (typeof COLOUR_SIGNED_VIA)[number];

/** One line of the form: what gets painted which colour. */
export interface ColourRow {
  id: string;
  room: string;
  surface: string;
  /** Colour name, e.g. "Alabaster". */
  colour: string;
  /** Maker's code, e.g. "SW 7008". */
  code: string;
  sheen: string;
  /** The signed estimate's line this row came from, so the work order can show it on that item. */
  lineId?: string | null;
}

/** The customer's details as written on the form (the customer record isn't changed by it). */
export interface ColourClient {
  name: string;
  email: string;
  phone: string;
  address: string;
}

/** The warnings the customer agreed to, word for word, so the signed copy can show them later. */
export interface ColourAcknowledgement {
  changeWarning: string;
  coverageWarning: string;
}

/**
 * The customer's colour choices for a job, signed off by the customer. Filled in by the
 * office or the colour consultant, or by the customer through a link (only the link's
 * sha256 is stored). A signed selection is never edited: changing colours makes a new
 * one that replaces it. Only src/server/colour-selections.ts writes this table.
 */
export const colourSelections = pgTable(
  "colour_selections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    status: text("status").$type<ColourSelectionStatus>().notNull().default("draft"),
    rows: jsonb("rows").$type<ColourRow[]>().notNull().default([]),
    client: jsonb("client").$type<ColourClient>().notNull(),
    notes: text("notes"),
    /** The signed selection this one replaces once it is signed. */
    replacesId: uuid("replaces_id"),
    /** sha256(token) of the customer's link, hex. */
    tokenHash: text("token_hash"),
    linkExpiresAt: ts("link_expires_at"),
    linkSentAt: ts("link_sent_at"),
    linkSentTo: text("link_sent_to"),
    signedName: text("signed_name"),
    signedAt: ts("signed_at"),
    /** PNG data URL. */
    signature: text("signature"),
    signedVia: text("signed_via").$type<ColourSignedVia>(),
    signedIp: text("signed_ip"),
    signedUserAgent: text("signed_user_agent"),
    acknowledged: jsonb("acknowledged").$type<ColourAcknowledgement>(),
    /** sha256 of what was signed (rows, client, warnings, name, time). */
    documentHash: text("document_hash"),
    /** Who in the office (or the colour consultant) last filled it in. */
    filledBy: text("filled_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("colour_selections_project_idx").on(t.projectId),
    index("colour_selections_customer_idx").on(t.customerId),
    uniqueIndex("colour_selections_token_idx").on(t.tokenHash),
    check("colour_selections_status_chk", sql`${t.status} IN ('draft','sent','signed','replaced','cancelled')`),
    check("colour_selections_via_chk", sql`${t.signedVia} IS NULL OR ${t.signedVia} IN ('link','device')`),
  ],
);

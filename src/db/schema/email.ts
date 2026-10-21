import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customers } from "./crm";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Emails from customers that arrived in the connected Gmail mailbox (replies to what we
 * sent, or new mail from a customer's address). Gmail keeps the original; this is what the
 * customer file and the office see. Only src/server/integrations/gmail.ts writes it.
 */
export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gmailMessageId: text("gmail_message_id").notNull(),
    threadId: text("thread_id"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    subject: text("subject"),
    /** The new part of the message (quoted earlier mail left out), up to 20,000 characters. */
    bodyText: text("body_text"),
    receivedAt: ts("received_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inbound_emails_gmail_idx").on(t.gmailMessageId), index("inbound_emails_customer_idx").on(t.customerId, t.receivedAt)],
);

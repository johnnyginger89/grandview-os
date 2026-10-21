CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gmail_message_id" text NOT NULL,
	"thread_id" text,
	"customer_id" uuid,
	"from_address" text NOT NULL,
	"from_name" text,
	"subject" text,
	"body_text" text,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "estimate_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_gmail_idx" ON "inbound_emails" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_customer_idx" ON "inbound_emails" USING btree ("customer_id","received_at");--> statement-breakpoint
ALTER TABLE "inbound_emails" ENABLE ROW LEVEL SECURITY;

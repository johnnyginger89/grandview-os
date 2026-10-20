CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "projects_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 3001 CACHE 1),
	"name" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"property_id" uuid,
	"estimate_id" uuid,
	"proposal_id" uuid,
	"opportunity_id" uuid,
	"status" text DEFAULT 'need_to_schedule' NOT NULL,
	"contract_price" numeric(14, 2) NOT NULL,
	"contract_total" numeric(14, 2) NOT NULL,
	"deposit_required" numeric(14, 2) DEFAULT '0' NOT NULL,
	"estimated_hours" numeric(14, 4) DEFAULT '0' NOT NULL,
	"estimated_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"project_manager_id" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"view" jsonb NOT NULL,
	"message" text,
	"sent_to" text,
	"sent_by" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_name" text,
	"accepted_email" text,
	"signature" text,
	"accepted_ip" text,
	"accepted_user_agent" text,
	"selected_option_ids" text[],
	"accepted_totals" jsonb,
	"document_hash" text,
	"declined_at" timestamp with time zone,
	"decline_reason" text
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_manager_id_user_id_fk" FOREIGN KEY ("project_manager_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_estimate_idx" ON "projects" USING btree ("estimate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_token_idx" ON "proposals" USING btree ("token");--> statement-breakpoint
CREATE INDEX "proposals_estimate_idx" ON "proposals" USING btree ("estimate_id");--> statement-breakpoint
-- New tables get the same Data API lock-down as 0002.
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;

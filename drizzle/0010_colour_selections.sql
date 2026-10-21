CREATE TABLE "colour_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client" jsonb NOT NULL,
	"notes" text,
	"replaces_id" uuid,
	"token_hash" text,
	"link_expires_at" timestamp with time zone,
	"link_sent_at" timestamp with time zone,
	"link_sent_to" text,
	"signed_name" text,
	"signed_at" timestamp with time zone,
	"signature" text,
	"signed_via" text,
	"signed_ip" text,
	"signed_user_agent" text,
	"acknowledged" jsonb,
	"document_hash" text,
	"filled_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "colour_selections_status_chk" CHECK ("colour_selections"."status" IN ('draft','sent','signed','replaced','cancelled')),
	CONSTRAINT "colour_selections_via_chk" CHECK ("colour_selections"."signed_via" IS NULL OR "colour_selections"."signed_via" IN ('link','device'))
);
--> statement-breakpoint
ALTER TABLE "colour_selections" ADD CONSTRAINT "colour_selections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "colour_selections" ADD CONSTRAINT "colour_selections_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "colour_selections" ADD CONSTRAINT "colour_selections_filled_by_user_id_fk" FOREIGN KEY ("filled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "colour_selections" ADD CONSTRAINT "colour_selections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "colour_selections_project_idx" ON "colour_selections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "colour_selections_customer_idx" ON "colour_selections" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "colour_selections_token_idx" ON "colour_selections" USING btree ("token_hash");--> statement-breakpoint
ALTER TABLE "colour_selections" ENABLE ROW LEVEL SECURITY;

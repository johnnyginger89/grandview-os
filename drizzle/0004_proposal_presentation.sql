CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"parts_received" integer DEFAULT 0 NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"data" "bytea" DEFAULT '\x'::bytea NOT NULL,
	"sha256" text,
	"original_filename" text NOT NULL,
	"title" text,
	"alt" text,
	"width" integer,
	"height" integer,
	"effective_on" date,
	"expires_on" date,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "media_kind_chk" CHECK ("media"."kind" IN ('image','document')),
	CONSTRAINT "media_status_chk" CHECK ("media"."status" IN ('pending','ready')),
	CONSTRAINT "media_type_chk" CHECK (("media"."kind" = 'image' AND "media"."content_type" IN ('image/jpeg','image/png','image/webp')) OR ("media"."kind" = 'document' AND "media"."content_type" IN ('application/pdf','image/jpeg','image/png'))),
	CONSTRAINT "media_size_chk" CHECK ("media"."byte_size" <= CASE WHEN "media"."kind" = 'image' THEN 3145728 ELSE 10485760 END)
);
--> statement-breakpoint
ALTER TABLE "estimate_areas" ADD COLUMN "customer_description" text;--> statement-breakpoint
ALTER TABLE "estimate_cost_items" ADD COLUMN "customer_description" text;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "customer_detail" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "areas_excluded" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "preparation_override" text;--> statement-breakpoint
ALTER TABLE "production_rates" ADD COLUMN "proposal_group" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "accepted_message" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "accepted_document_ids" uuid[];--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_purpose_idx" ON "media" USING btree ("purpose","status","archived_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_purpose_sha_idx" ON "media" USING btree ("purpose","sha256") WHERE status = 'ready';--> statement-breakpoint
-- New tables get the same Data API lock-down as 0002.
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;

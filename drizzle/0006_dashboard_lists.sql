CREATE TABLE "project_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text,
	"source" text DEFAULT 'app' NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "visit_booked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "visit_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sold_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_status_events" ADD CONSTRAINT "project_status_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_events" ADD CONSTRAINT "project_status_events_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pse_project_idx" ON "project_status_events" USING btree ("project_id","changed_at");--> statement-breakpoint
CREATE INDEX "pse_to_status_idx" ON "project_status_events" USING btree ("to_status","effective_at");--> statement-breakpoint
CREATE INDEX "activities_opp_created_idx" ON "activities" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE INDEX "opp_created_idx" ON "opportunities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "opp_closed_idx" ON "opportunities" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "estimates_opportunity_idx" ON "estimates" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "projects_sold_idx" ON "projects" USING btree ("sold_at");--> statement-breakpoint
CREATE INDEX "projects_completed_idx" ON "projects" USING btree ("completed_at");--> statement-breakpoint
-- New tables get the same Data API lock-down as 0002.
ALTER TABLE "project_status_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- ADD COLUMN filled sold_at with the migration time; use the real signing time instead.
-- Projects that already have a status event were created by new code with the right sold_at.
UPDATE "projects" p SET "sold_at" = COALESCE(
  (SELECT pr."accepted_at" FROM "proposals" pr WHERE pr."id" = p."proposal_id"),
  (SELECT e."accepted_at" FROM "estimates" e WHERE e."id" = p."estimate_id"),
  p."created_at")
  WHERE NOT EXISTS (SELECT 1 FROM "project_status_events" ev WHERE ev."project_id" = p."id");--> statement-breakpoint
UPDATE "projects" SET "completed_at" = COALESCE("end_date", "updated_at")
  WHERE "status" IN ('complete', 'invoiced', 'closed') AND "completed_at" IS NULL;--> statement-breakpoint
UPDATE "projects" SET "cancelled_at" = "updated_at"
  WHERE "status" = 'cancelled' AND "cancelled_at" IS NULL;--> statement-breakpoint
INSERT INTO "project_status_events" ("project_id", "from_status", "to_status", "effective_at", "changed_at", "source", "note")
  SELECT p."id", NULL, p."status",
    CASE WHEN p."status" IN ('complete', 'invoiced', 'closed') THEN COALESCE(p."completed_at", p."sold_at")
         WHEN p."status" = 'cancelled' THEN COALESCE(p."cancelled_at", p."sold_at")
         ELSE p."sold_at" END,
    p."created_at", 'backfill', 'Status at migration'
  FROM "projects" p
  WHERE NOT EXISTS (SELECT 1 FROM "project_status_events" ev WHERE ev."project_id" = p."id");--> statement-breakpoint
UPDATE "opportunities" o SET "visit_booked_at" = COALESCE(
  (SELECT min(a."created_at") FROM "activities" a WHERE a."opportunity_id" = o."id" AND a."type" = 'booking'),
  o."created_at")
  WHERE o."estimate_visit_at" IS NOT NULL AND o."visit_booked_at" IS NULL;--> statement-breakpoint
UPDATE "opportunities" o SET "visit_completed_at" = o."estimate_visit_at"
  FROM "pipeline_stages" s
  WHERE s."id" = o."stage_id" AND o."estimate_visit_at" IS NOT NULL AND o."estimate_visit_at" < now()
    AND o."visit_completed_at" IS NULL
    AND (s."key" IN ('estimate_completed', 'proposal_sent', 'won')
         OR EXISTS (SELECT 1 FROM "estimates" e WHERE e."opportunity_id" = o."id"));

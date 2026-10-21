CREATE TABLE "crew_members" (
	"crew_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_members_crew_id_user_id_pk" PRIMARY KEY("crew_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'in_house' NOT NULL,
	"trade" text DEFAULT 'painting' NOT NULL,
	"sub_company" text,
	"color" text DEFAULT 'sky' NOT NULL,
	"crew_size" integer DEFAULT 3 NOT NULL,
	"hours_per_day" numeric(4, 2) DEFAULT '8' NOT NULL,
	"works_saturdays" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"external_ref" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crews_kind_chk" CHECK ("crews"."kind" IN ('in_house','subcontractor')),
	CONSTRAINT "crews_size_chk" CHECK ("crews"."crew_size" BETWEEN 1 AND 50),
	CONSTRAINT "crews_hours_chk" CHECK ("crews"."hours_per_day" > 0 AND "crews"."hours_per_day" <= 24)
);
--> statement-breakpoint
CREATE TABLE "project_readiness" (
	"project_id" uuid NOT NULL,
	"check_key" text NOT NULL,
	"state" text DEFAULT 'todo' NOT NULL,
	"due_date" date,
	"note" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_readiness_project_id_check_key_pk" PRIMARY KEY("project_id","check_key"),
	CONSTRAINT "readiness_state_chk" CHECK ("project_readiness"."state" IN ('todo','in_progress','done','not_needed'))
);
--> statement-breakpoint
CREATE TABLE "project_scheduling" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"confirmation" text DEFAULT 'none' NOT NULL,
	"notice_variant" text,
	"week_sent_at" timestamp with time zone,
	"week_confirmed_at" timestamp with time zone,
	"date_sent_at" timestamp with time zone,
	"date_confirmed_at" timestamp with time zone,
	"confirmed_via" text,
	"communicated_start" date,
	"communicated_end" date,
	"not_before" date,
	"scheduling_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psched_conf_chk" CHECK ("project_scheduling"."confirmation" IN ('none','week_sent','week_confirmed','date_sent','date_confirmed')),
	CONSTRAINT "psched_variant_chk" CHECK ("project_scheduling"."notice_variant" IS NULL OR "project_scheduling"."notice_variant" IN ('interior','exterior')),
	CONSTRAINT "psched_via_chk" CHECK ("project_scheduling"."confirmed_via" IS NULL OR "project_scheduling"."confirmed_via" IN ('email','phone','text','in_person'))
);
--> statement-breakpoint
CREATE TABLE "schedule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"crew_id" uuid,
	"kind" text DEFAULT 'work' NOT NULL,
	"phase_label" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"planned_hours" numeric(8, 2),
	"notes" text,
	"crew_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	CONSTRAINT "sched_dates_chk" CHECK ("schedule_entries"."end_date" >= "schedule_entries"."start_date" AND "schedule_entries"."end_date" - "schedule_entries"."start_date" <= 180),
	CONSTRAINT "sched_kind_chk" CHECK ("schedule_entries"."kind" IN ('work','pressure_wash','colour_consult','walk_through','touch_up'))
);
--> statement-breakpoint
CREATE TABLE "work_order_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"last_opened_at" timestamp with time zone,
	"last_opened_version" integer
);
--> statement-breakpoint
CREATE TABLE "work_order_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"view" jsonb NOT NULL,
	"change_note" text,
	"issued_by" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_versions_version_chk" CHECK ("work_order_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "work_orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 7001 CACHE 1),
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"special_instructions" text,
	"equipment" text,
	"safety_notes" text,
	"access_notes" text,
	"show_customer_phone" boolean DEFAULT false NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"crew_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_status_chk" CHECK ("work_orders"."status" IN ('draft','issued','cancelled')),
	CONSTRAINT "work_orders_version_chk" CHECK ("work_orders"."current_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_readiness" ADD CONSTRAINT "project_readiness_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_readiness" ADD CONSTRAINT "project_readiness_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_scheduling" ADD CONSTRAINT "project_scheduling_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_scheduling" ADD CONSTRAINT "project_scheduling_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_links" ADD CONSTRAINT "work_order_links_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_links" ADD CONSTRAINT "work_order_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_versions" ADD CONSTRAINT "work_order_versions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_versions" ADD CONSTRAINT "work_order_versions_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crew_members_user_idx" ON "crew_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crew_members_one_lead_idx" ON "crew_members" USING btree ("crew_id") WHERE is_lead;--> statement-breakpoint
CREATE UNIQUE INDEX "crews_name_idx" ON "crews" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "crews_active_idx" ON "crews" USING btree ("active","sort_order");--> statement-breakpoint
CREATE INDEX "psched_not_before_idx" ON "project_scheduling" USING btree ("not_before");--> statement-breakpoint
CREATE INDEX "sched_project_idx" ON "schedule_entries" USING btree ("project_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sched_crew_range_idx" ON "schedule_entries" USING btree ("crew_id","start_date","end_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sched_range_idx" ON "schedule_entries" USING btree ("start_date","end_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sched_updated_idx" ON "schedule_entries" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_links_token_idx" ON "work_order_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "work_order_links_wo_idx" ON "work_order_links" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_versions_idx" ON "work_order_versions" USING btree ("work_order_id","version");--> statement-breakpoint
CREATE INDEX "work_orders_project_idx" ON "work_orders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_orders_crew_idx" ON "work_orders" USING btree ("crew_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_number_idx" ON "work_orders" USING btree ("number");--> statement-breakpoint
-- New tables get the same Data API lock-down as 0002.
ALTER TABLE "crews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crew_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_scheduling" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_readiness" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_order_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_order_links" ENABLE ROW LEVEL SECURITY;

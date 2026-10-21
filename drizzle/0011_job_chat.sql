CREATE TABLE "job_channel_members" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	CONSTRAINT "job_channel_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "job_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"author_id" text,
	"kind" text DEFAULT 'message' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"percent_complete" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_messages_kind_chk" CHECK ("job_messages"."kind" IN ('message','daily_update','system')),
	CONSTRAINT "job_messages_percent_chk" CHECK ("job_messages"."percent_complete" IS NULL OR "job_messages"."percent_complete" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "job_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"message_id" uuid,
	"uploaded_by" text,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"thumb" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_photos_type_chk" CHECK ("job_photos"."content_type" IN ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "job_photos_size_chk" CHECK ("job_photos"."byte_size" <= 3145728)
);
--> statement-breakpoint
ALTER TABLE "job_channel_members" ADD CONSTRAINT "job_channel_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_channel_members" ADD CONSTRAINT "job_channel_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_channel_members" ADD CONSTRAINT "job_channel_members_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_messages" ADD CONSTRAINT "job_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_messages" ADD CONSTRAINT "job_messages_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_message_id_job_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."job_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_channel_members_user_idx" ON "job_channel_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "job_messages_project_idx" ON "job_messages" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "job_photos_message_idx" ON "job_photos" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "job_photos_project_idx" ON "job_photos" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "job_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_channel_members" ENABLE ROW LEVEL SECURITY;

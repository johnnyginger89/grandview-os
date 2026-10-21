CREATE TABLE "integration_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text,
	"external_name" text,
	"linked_by" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_links_provider_chk" CHECK ("integration_links"."provider" IN ('companycam')),
	CONSTRAINT "integration_links_entity_chk" CHECK ("integration_links"."entity_type" IN ('project','estimate'))
);
--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_linked_by_user_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_links_entity_idx" ON "integration_links" USING btree ("provider","entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "integration_links" ENABLE ROW LEVEL SECURITY;

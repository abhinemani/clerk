CREATE TYPE "public"."publication_decision_kind" AS ENUM('published', 'kept_internal', 'unpublished');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instance_meta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publication_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"decision" "publication_decision_kind" NOT NULL,
	"by_user_id" uuid NOT NULL,
	"by_name" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publication_decisions" ADD CONSTRAINT "publication_decisions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publication_decisions_agency_doc_idx" ON "publication_decisions" USING btree ("agency_id","document_id","created_at");
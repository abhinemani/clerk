CREATE TYPE "public"."jurisdiction_type" AS ENUM('city', 'county', 'state', 'federal', 'school_district', 'special_district', 'court', 'other');--> statement-breakpoint
ALTER TYPE "public"."request_status" ADD VALUE 'referred' BEFORE 'withdrawn';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency_directory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"jurisdiction_type" "jurisdiction_type" DEFAULT 'other' NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"portal_url" text,
	"record_types" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"peer_agency_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_directory_agency_name_unique" UNIQUE("agency_id","name")
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "referred_to_directory_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "referred_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_directory" ADD CONSTRAINT "agency_directory_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_directory" ADD CONSTRAINT "agency_directory_peer_agency_id_agencies_id_fk" FOREIGN KEY ("peer_agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_directory_agency_idx" ON "agency_directory" USING btree ("agency_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "requests" ADD CONSTRAINT "requests_referred_to_directory_id_agency_directory_id_fk" FOREIGN KEY ("referred_to_directory_id") REFERENCES "public"."agency_directory"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

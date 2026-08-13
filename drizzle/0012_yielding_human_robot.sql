CREATE TABLE IF NOT EXISTS "request_plays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"keywords" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"episode_count" integer NOT NULL,
	"rebuilt_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_plays" ADD CONSTRAINT "request_plays_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_plays_agency_idx" ON "request_plays" USING btree ("agency_id");
CREATE TABLE IF NOT EXISTS "network_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_code" text NOT NULL,
	"topic" text NOT NULL,
	"agency_count" integer NOT NULL,
	"episodes" text NOT NULL,
	"routes" jsonb,
	"exemption_sections" jsonb,
	"days_to_close" text,
	"extension_rate" text,
	"basis" text NOT NULL,
	"pending_agency_count" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_aggregates_state_topic_idx" ON "network_aggregates" USING btree ("state_code","topic");
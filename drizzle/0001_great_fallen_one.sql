CREATE TYPE "public"."agent_run_status" AS ENUM('planning', 'running', 'paused', 'awaiting_checkpoint', 'completed', 'exhausted', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('fulfillment', 'deadline', 'release_prep', 'ingest_steward', 'requester_side');--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'agent_action' BEFORE 'approval';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"agent_type" "agent_type" NOT NULL,
	"request_id" uuid,
	"status" "agent_run_status" DEFAULT 'planning' NOT NULL,
	"goal" text NOT NULL,
	"plan" jsonb,
	"budget_limits" jsonb,
	"budget_spend" jsonb,
	"corpus_scope" "classification",
	"started_by_user_id" uuid,
	"paused_by_user_id" uuid,
	"handoff_note" text,
	"last_step_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_events" ADD COLUMN "agent_run_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_paused_by_user_id_users_id_fk" FOREIGN KEY ("paused_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_agency_status_idx" ON "agent_runs" USING btree ("agency_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_request_idx" ON "agent_runs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_events_agent_run_idx" ON "request_events" USING btree ("agent_run_id");
CREATE TABLE IF NOT EXISTS "demo_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organization" text NOT NULL,
	"role" text,
	"state_code" text,
	"days" jsonb NOT NULL,
	"windows" jsonb NOT NULL,
	"timezone" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demo_requests_created_idx" ON "demo_requests" USING btree ("created_at");
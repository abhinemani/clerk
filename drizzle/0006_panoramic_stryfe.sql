ALTER TABLE "documents" ADD COLUMN "retention_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "legal_hold_reason" text;
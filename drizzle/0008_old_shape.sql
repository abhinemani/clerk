ALTER TABLE "requests" ADD COLUMN "forwarded_from" jsonb;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "forwarded_to" jsonb;
CREATE TABLE IF NOT EXISTS "dataset_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"dataset" text NOT NULL,
	"period" text NOT NULL,
	"row_index" integer NOT NULL,
	"record_date" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dataset_rows" ADD CONSTRAINT "dataset_rows_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dataset_rows" ADD CONSTRAINT "dataset_rows_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dataset_rows_agency_dataset_idx" ON "dataset_rows" USING btree ("agency_id","dataset","record_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dataset_rows_document_idx" ON "dataset_rows" USING btree ("document_id");
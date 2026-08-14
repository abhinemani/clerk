CREATE INDEX IF NOT EXISTS "document_chunks_agency_idx" ON "document_chunks" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_agency_created_idx" ON "documents" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_documents_document_idx" ON "request_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_agency_created_idx" ON "requests" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_embedding_hnsw_idx" ON "requests" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_agency_idx" ON "reviews" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_agency_idx" ON "tasks" USING btree ("agency_id");
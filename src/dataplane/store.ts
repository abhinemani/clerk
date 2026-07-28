/**
 * Process-local dev store so the ingestion API is genuinely callable with
 * `npm run dev` (before a real Postgres is wired). A module-level singleton
 * persists across requests within the dev server process.
 */
import { InMemoryRepository } from "@/services/repository";
import type { SourceConfig } from "./normalize";

export const DEV_INGEST_KEY = "dev-ingest-key";

export const devRepo = new InMemoryRepository().seedAgency({
  id: "ag-riverton",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
});

export const DEV_SOURCE: SourceConfig = {
  id: "src-api",
  trust: "auto_publish",
  defaultClassification: "public",
};

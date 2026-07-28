/**
 * Ingestion API config. The repository now comes from `getRepository()` (PGlite
 * or Postgres); a real deployment would resolve the Source + API key per-agency
 * from the DB. For the prototype these are fixed dev values.
 */
import type { SourceConfig } from "./normalize";

export const DEV_INGEST_KEY = "dev-ingest-key";

export const DEV_SOURCE: SourceConfig = {
  id: "src-api",
  trust: "auto_publish",
  defaultClassification: "public",
};

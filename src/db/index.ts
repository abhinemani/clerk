/**
 * Postgres connection + Drizzle client (spec §4).
 *
 * Tenant isolation (§10) is enforced in the data-access layer, not here — every
 * query that touches a domain table must filter by `agencyId`. A future helper
 * (`forAgency(agencyId)`) will wrap this client to make that the default.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://localhost:5432/holmes";

// `postgres-js` single connection pool. `prepare: false` keeps compatibility with
// connection poolers (PgBouncer transaction mode) used in serverless deploys.
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;

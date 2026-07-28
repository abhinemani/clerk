/**
 * Repository factory (turnkey deploy).
 *
 *   DATABASE_URL set  → managed Postgres (Neon / Vercel Postgres) via postgres-js
 *   else              → embedded PGlite (Postgres in-process, +pgvector),
 *                       persisting to PGLITE_PATH (a mounted volume) or in-memory
 *
 * One schema, one adapter, one set of migrations — run automatically on first
 * use. Deploy to Vercel+Neon (set DATABASE_URL) or a container+volume (set
 * PGLITE_PATH) with the same code; locally it "just works" with no config.
 */
import { join } from "node:path";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { DrizzleRepository } from "./repository/drizzleRepository";
import type { Repository } from "@/services/repository";

type Db = PgDatabase<any, any, any>;

const MIGRATIONS = join(process.cwd(), "drizzle");

async function buildDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const [{ drizzle }, { migrate }, postgres] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("drizzle-orm/postgres-js/migrator"),
      import("postgres").then((m) => m.default),
    ]);
    const client = postgres(url, { prepare: false, max: 1 });
    const db = drizzle(client, { schema }) as unknown as Db;
    await migrate(db as never, { migrationsFolder: MIGRATIONS });
    return db;
  }

  // Embedded PGlite. dataDir persists to a volume if PGLITE_PATH is set.
  const [{ drizzle }, { migrate }, { PGlite }, { vector }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/vector"),
  ]);
  // PGLITE_PATH persists to a volume; locally we default to ./.pgdata so a filed
  // request survives a restart. On Vercel (ephemeral FS) fall back to in-memory —
  // there you'd set DATABASE_URL to a managed Postgres instead.
  const dataDir = process.env.PGLITE_PATH ?? (process.env.VERCEL ? undefined : join(process.cwd(), ".pgdata"));
  const pg = new PGlite({ dataDir, extensions: { vector } });
  const db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  return db;
}

// Memoized on globalThis, not module scope: Next dev compiles routes into
// separate server bundles, each with its own module registry. Module-scoped
// memoization would open several PGlite instances against the same dataDir —
// PGlite is single-writer, so writes from one bundle would be invisible (or
// corrupting) to another. One process → one database handle.
interface DbGlobal {
  __clerkDbPromise?: Promise<Db>;
  __clerkRepoPromise?: Promise<Repository>;
}
const g = globalThis as DbGlobal;

/** The configured Drizzle db — memoized so migrations run once per process. */
export function getDb(): Promise<Db> {
  if (!g.__clerkDbPromise) g.__clerkDbPromise = buildDb();
  return g.__clerkDbPromise;
}

/** The app's repository (over getDb()). */
export function getRepository(): Promise<Repository> {
  if (!g.__clerkRepoPromise) g.__clerkRepoPromise = getDb().then((db) => new DrizzleRepository(db));
  return g.__clerkRepoPromise;
}

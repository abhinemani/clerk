/**
 * This database's own identity — a UUID minted once, on first use, into the
 * one-row `instance_meta` table. Session JWTs carry it as the `inst` claim
 * and the guards reject any token minted against a different database:
 * a cookie from another deployment sharing AUTH_SECRET, or from a dev
 * database that has since been recreated, grants nothing.
 *
 * Operational lever: deleting the row and inserting a fresh one signs every
 * principal out at once (stolen laptop, departed employee with unknown
 * sessions) without rotating AUTH_SECRET across config.
 */
import { asc } from "drizzle-orm";
import { getDb } from "@/db/createRepository";
import { instanceMeta } from "@/db/schema";

interface InstanceGlobal {
  __brandeisInstanceId?: Promise<string>;
}
const g = globalThis as InstanceGlobal;

export function getInstanceId(): Promise<string> {
  if (!g.__brandeisInstanceId) {
    g.__brandeisInstanceId = resolveInstanceId().catch((err) => {
      // Don't cache a failure — next call retries.
      g.__brandeisInstanceId = undefined;
      throw err;
    });
  }
  return g.__brandeisInstanceId;
}

async function resolveInstanceId(): Promise<string> {
  const db = await getDb();
  const pick = () =>
    db.select().from(instanceMeta).orderBy(asc(instanceMeta.createdAt), asc(instanceMeta.id)).limit(1);

  const [existing] = await pick();
  if (existing) return existing.id;

  // First boot: mint one. If two processes race here, both insert and both
  // then converge on the same OLDEST row — extra rows are inert.
  await db.insert(instanceMeta).values({ id: crypto.randomUUID() });
  const [row] = await pick();
  return row!.id;
}

/**
 * One-time auth tokens (verification, password reset, staff invites).
 * Only the sha-256 of a token is ever stored; the raw value exists once, in
 * the delivered link. Consuming is single-use and expiry-checked.
 */
import { createHash, randomBytes } from "node:crypto";
import type { ServiceDeps } from "@/services/deps";
import type { AuthTokenEntity, AuthTokenKind } from "@/services/repository";

const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000; // 48h

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Mint a token; returns the raw value (for the link) exactly once. */
export async function mintToken(
  deps: ServiceDeps,
  input: { agencyId: string; kind: AuthTokenKind; subjectId: string; ttlMs?: number },
): Promise<{ raw: string; entity: AuthTokenEntity }> {
  const raw = randomBytes(24).toString("base64url");
  const entity = await deps.repo.createAuthToken({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: input.kind,
    subjectId: input.subjectId,
    tokenHash: hashToken(raw),
    expiresAt: new Date(deps.now().getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)),
    usedAt: null,
    createdAt: deps.now(),
  });
  return { raw, entity };
}

/** Validate + burn a token. Returns null for unknown/expired/used/wrong-kind. */
export async function consumeToken(
  deps: ServiceDeps,
  raw: string,
  kind: AuthTokenKind,
): Promise<AuthTokenEntity | null> {
  if (!raw) return null;
  const token = await deps.repo.findAuthTokenByHash(hashToken(raw));
  if (!token || token.kind !== kind || token.usedAt || token.expiresAt < deps.now()) return null;
  await deps.repo.markAuthTokenUsed(token.id, deps.now());
  return token;
}

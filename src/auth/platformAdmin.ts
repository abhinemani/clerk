/**
 * Platform-operator credentials — the ONE cross-tenant principal in the
 * product, so its credentials get the same posture as AUTH_SECRET
 * (resolveAuthSecret in src/auth/index.ts): a dev fallback that is public
 * knowledge must never authenticate in production.
 *
 * Env-only account (no tenant row): PLATFORM_ADMIN_EMAIL +
 * PLATFORM_ADMIN_PASSWORD. In production BOTH must be set or platform
 * sign-in is disabled outright — a deployment that never sets them simply
 * has no operator console, which is safe; the tenant surfaces don't need it.
 * Dev/test keep the printed defaults (`npm run seed` banner).
 */
export interface PlatformAdminCreds {
  email: string;
  password: string;
}

export const DEV_PLATFORM_ADMIN: PlatformAdminCreds = {
  email: "admin@brandeis.example",
  password: "brandeis-admin-dev",
};

export function resolvePlatformAdmin(
  env: {
    PLATFORM_ADMIN_EMAIL?: string;
    PLATFORM_ADMIN_PASSWORD?: string;
    NODE_ENV?: string;
  } = process.env,
): PlatformAdminCreds | null {
  const email = env.PLATFORM_ADMIN_EMAIL?.trim();
  const password = env.PLATFORM_ADMIN_PASSWORD;
  if (email && password) return { email, password };
  // Anything less than both set means the known dev defaults would be in
  // play — never in production, not even for the half that IS set.
  if (env.NODE_ENV === "production") return null;
  return {
    email: email || DEV_PLATFORM_ADMIN.email,
    password: password || DEV_PLATFORM_ADMIN.password,
  };
}

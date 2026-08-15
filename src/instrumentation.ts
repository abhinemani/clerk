/**
 * Next.js instrumentation hook — runs once per server start. Registers job
 * handlers and the nightly deadline sweep (Node runtime only).
 */
export async function register() {
  // Claude Code cloud environments filter the exact name ANTHROPIC_API_KEY
  // out of session env (sessions authenticate through the Anthropic account,
  // and the platform reserves the name). CLOUD_ANTHROPIC_API_KEY is the
  // pass-through alias the owner sets in the environment config instead; map
  // it before anything reads the canonical name. A real ANTHROPIC_API_KEY
  // always wins. Same mapping exists in vitest.config.ts for `npm run eval`.
  if (!process.env.ANTHROPIC_API_KEY && process.env.CLOUD_ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = process.env.CLOUD_ANTHROPIC_API_KEY;
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // SEED_DEMO=true: seed the demo tenants in-process at boot — the only
    // safe way to seed a running server (PGlite is single-writer; a separate
    // seeding process against a live data dir risks corruption). Idempotent.
    if (process.env.SEED_DEMO === "true" || process.env.SEED_DEMO === "1") {
      try {
        const { seedDemoTenants, printCredentials } = await import("@/lib/seedDemo");
        const { seeded } = await seedDemoTenants();
        if (seeded) printCredentials();
      } catch (err) {
        console.error("[boot] demo seeding failed", err);
      }
    }

    const { registerJobs } = await import("@/jobs/register");
    registerJobs();
  }
}

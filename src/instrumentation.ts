/**
 * Next.js instrumentation hook — runs once per server start. Registers job
 * handlers and the nightly deadline sweep (Node runtime only).
 */
export async function register() {
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

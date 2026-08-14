/**
 * Next.js instrumentation hook — runs once per server start. Registers job
 * handlers and the nightly deadline sweep (Node runtime only).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // SEED_DEMO=true: seed the demo tenants in-process at boot — the only
    // safe way to seed a running server (PGlite is single-writer; a separate
    // seeding process against a live data dir risks corruption). Idempotent.
    // SEED_FULL_CITY=true additionally layers on the much larger historical
    // Riverton dataset (src/lib/seedFullCity.ts) — implies SEED_DEMO.
    if (
      process.env.SEED_DEMO === "true" ||
      process.env.SEED_DEMO === "1" ||
      process.env.SEED_FULL_CITY === "true" ||
      process.env.SEED_FULL_CITY === "1"
    ) {
      try {
        const { seedDemoTenants, printCredentials } = await import("@/lib/seedDemo");
        const { seeded } = await seedDemoTenants();
        let fullSeeded = false;
        if (process.env.SEED_FULL_CITY === "true" || process.env.SEED_FULL_CITY === "1") {
          const { seedFullCity } = await import("@/lib/seedFullCity");
          fullSeeded = (await seedFullCity()).seeded;
        }
        if (seeded || fullSeeded) printCredentials();
      } catch (err) {
        console.error("[boot] demo seeding failed", err);
      }
    }

    const { registerJobs } = await import("@/jobs/register");
    registerJobs();
  }
}

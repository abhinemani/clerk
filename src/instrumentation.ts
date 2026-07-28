/**
 * Next.js instrumentation hook — runs once per server start. Registers job
 * handlers and the nightly deadline sweep (Node runtime only).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerJobs } = await import("@/jobs/register");
    registerJobs();
  }
}

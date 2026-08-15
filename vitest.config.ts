import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

/**
 * Load .env for EVAL runs only (`npm run eval`, which sets RUN_LIVE_EVALS).
 * Next.js does this for the app, but vitest does not — without it the live
 * scored runs silently skip even with a key configured, which reads as "the
 * evals passed" when they never executed.
 *
 * Scoped deliberately: `npm test` must stay fast, offline, and deterministic,
 * and several unit tests assert behavior when an env var is ABSENT — loading
 * .env for them would make the suite depend on the developer's machine.
 * Only fills variables that aren't already set, so an explicit
 * `ANTHROPIC_API_KEY=… npm run eval` still wins.
 */
function loadDotEnv(): void {
  if (!process.env.RUN_LIVE_EVALS) return;
  try {
    const raw = readFileSync(new URL("./.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env — the app is designed to run without one; live evals just skip.
  }
  // Cloud sessions can't receive ANTHROPIC_API_KEY by that name (the platform
  // filters it from session env; see src/instrumentation.ts). Accept the
  // CLOUD_ANTHROPIC_API_KEY alias so `npm run eval` scores live there too.
  if (!process.env.ANTHROPIC_API_KEY && process.env.CLOUD_ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = process.env.CLOUD_ANTHROPIC_API_KEY;
  }
}
loadDotEnv();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
    // Strips inherited service env vars (real keys must never reach the
    // offline suite); no-op under RUN_LIVE_EVALS. See vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

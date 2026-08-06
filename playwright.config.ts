/**
 * E2E smoke config — ONE journey through the spine (e2e/spine.spec.ts), run
 * against a throwaway PGlite database seeded at boot. Deliberately outside
 * `npm test` (which stays fast/offline); run with `npm run test:e2e`.
 *
 * Each run gets a fresh data dir under the OS tmpdir, so the smoke never
 * touches a developer's ./.pgdata (PGlite is single-writer — sharing a data
 * dir with a running dev server corrupts it).
 */
import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3499;
const dataRoot = mkdtempSync(join(tmpdir(), "clerk-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    port: PORT,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      PGLITE_PATH: join(dataRoot, "pgdata"),
      BLOB_PATH: join(dataRoot, "blobdata"),
      SEED_DEMO: "true",
      APP_BASE_URL: `http://localhost:${PORT}`,
      AUTH_SECRET: "e2e-smoke-secret",
    },
  },
});

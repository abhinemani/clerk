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
const dataRoot = mkdtempSync(join(tmpdir(), "brandeis-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // ONE worker: all specs share one dev server + database; parallel specs
  // mutating the same seeded requests race each other (we hit this).
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // The marketing page's scroll-reveal (CSS animation-timeline) starts
    // sections at opacity 0; a context without this takes BLANK full-page
    // screenshots and any future spec that asserts on below-the-fold
    // content walks into it (HANDOFF gotcha 12's automation half).
    // (This Playwright version only takes it via contextOptions.)
    contextOptions: { reducedMotion: "reduce" },
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
      // Connected-source file drops land in the throwaway root too, so a
      // smoke run never writes CSVs into the working tree.
      CONNECTED_DROP_PATH: join(dataRoot, "connected-drop"),
      SEED_DEMO: "true",
      APP_BASE_URL: `http://localhost:${PORT}`,
      AUTH_SECRET: "e2e-smoke-secret",
      // The smoke is offline by contract, but this env block MERGES into the
      // shell's — a machine (or cloud session) carrying real keys would boot
      // the server onto live providers. Blank them explicitly; every factory
      // treats empty as unset. Same guard as vitest.setup.ts.
      ANTHROPIC_API_KEY: "",
      VOYAGE_API_KEY: "",
      ELASTICSEARCH_URL: "",
      DATABASE_URL: "",
      S3_ENDPOINT: "",
      CLAMAV_HOST: "",
      TESSERACT_PATH: "",
      OCR_ENDPOINT: "",
      EMAIL_FROM: "",
      POSTMARK_SERVER_TOKEN: "",
      RESEND_API_KEY: "",
      INBOUND_EMAIL_TOKEN: "",
    },
  },
});

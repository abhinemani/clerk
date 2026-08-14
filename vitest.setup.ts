/**
 * Keep real keys out of the offline suite. `npm test` promises offline +
 * deterministic, but the adapters select real services off process.env at
 * call time — so a machine (or a cloud session) that carries real keys
 * silently flips unit tests onto live providers. That actually happened: a
 * cloud container with VOYAGE_API_KEY in its environment sent unit-test
 * embeddings to Voyage, where the calls failed through the proxy and two
 * tests went red with empty vectors. On a machine where the calls SUCCEED
 * it is worse — spent credits and nondeterministic vectors that happen to
 * pass.
 *
 * So: strip every behavior-selecting env var before any test file loads.
 * Tests that assert env-driven behavior set the variable themselves (or pass
 * an env object), which still works — this only removes what the suite
 * inherited from the shell.
 *
 * `npm run eval` (RUN_LIVE_EVALS=1) is the one deliberate exception: those
 * runs exist to hit the live API and load `.env` for exactly that purpose
 * (see vitest.config.ts), so nothing is stripped there.
 */
const SERVICE_ENV_VARS = [
  // AI providers
  "ANTHROPIC_API_KEY",
  "VOYAGE_API_KEY",
  // search cluster
  "ELASTICSEARCH_URL",
  "ELASTICSEARCH_INDEX",
  "ELASTICSEARCH_API_KEY",
  // database + storage
  "DATABASE_URL",
  "PGLITE_PATH",
  "BLOB_PATH",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "CONNECTED_DROP_PATH",
  // scanning / OCR
  "CLAMAV_HOST",
  "CLAMAV_PORT",
  "TESSERACT_PATH",
  "OCR_ENDPOINT",
  "OCR_LANGS",
  // email, both directions
  "EMAIL_FROM",
  "POSTMARK_SERVER_TOKEN",
  "RESEND_API_KEY",
  "INBOUND_EMAIL_TOKEN",
  "INBOUND_EMAIL_DOMAIN",
  // deployment/behavior toggles
  "APP_BASE_URL",
  "SEED_DEMO",
  "SELF_SIGNUP",
  "SIGNUP_REQUIRE_GOV_EMAIL",
  "PLATFORM_ADMIN_EMAIL",
  "PLATFORM_ADMIN_PASSWORD",
  "AUTH_SECRET",
];

if (!process.env.RUN_LIVE_EVALS) {
  for (const name of SERVICE_ENV_VARS) delete process.env[name];
}

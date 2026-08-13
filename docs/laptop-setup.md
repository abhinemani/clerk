# Setting up Brandeis on a fresh laptop — the owner's checklist

Started 2026-08-13 (owner ask). Everything needed to go from a blank machine
to a fully-capable local instance: the zero-key path first, then every key
worth obtaining, what each unlocks, and how to verify it took. Keep this
current — when a new env var or external service lands, it gets a section
here in the same commit.

## 0. The zero-key baseline (10 minutes, nothing to sign up for)

The product is self-contained first: this path needs no accounts at all.

```bash
# Node 20+ — on macOS via Homebrew (remember: Homebrew's node is not on the
# default PATH in some shells; add it if `node -v` comes up empty):
brew install node git
export PATH="/opt/homebrew/bin:$PATH"

# The repo is still named clerk (GitHub + clone dir are outside the
# codebase's reach; the product is Brandeis):
git clone https://github.com/abhinemani/clerk.git && cd clerk

npm install          # npm, not pnpm
npm test             # 700+ tests, offline + deterministic — should pass clean
npm run seed         # City of Riverton demo agency (prints the credentials)
npm run dev          # http://localhost:3000
```

What works with zero keys: the entire request lifecycle, redaction studio,
publication queue, BM25 search, statutory clocks, outbox-mode email (the
outbox IS the audit record; delivery is an upgrade), EICAR virus scanning,
deterministic fake embeddings. What's dormant: everything AI (triage,
copilot, redaction suggestions, answer judging), real email delivery, OCR,
real embeddings.

Seeded demo logins (also printed by the seed):

| Who | Login |
| --- | --- |
| Riverton coordinator | `dana@riverton.gov` / `riverton-demo` |
| Riverton coordinator 2 | `casey@riverton.gov` / `riverton-demo2` |
| Riverton responder (Public Works) | `sam@riverton.gov` / `riverton-demo3` |
| Resident | `jordan@rivertonledger.com` / `riverton-resident` |
| Bellmar staff | `amara@bellmar.gov` / `bellmar-demo` |
| Platform console (/admin) | `admin@brandeis.example` / `brandeis-admin-dev` |

(If `.env` sets `PLATFORM_ADMIN_EMAIL`/`_PASSWORD`, those override the
seeded default — check `.env` before assuming the demo creds. We hit this.)

## 1. `.env` — create it before adding any keys

```bash
cp .env.example .env
# Session signing — required for anything beyond throwaway dev:
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
# Platform operator login for /admin — pick real values:
echo "PLATFORM_ADMIN_EMAIL=you@example.com" >> .env
echo "PLATFORM_ADMIN_PASSWORD=$(openssl rand -base64 18)" >> .env
```

Two facts about `.env` that surprise later: `npm test` NEVER loads it
(offline + deterministic on purpose — only `npm run eval` loads `.env`),
and the dev server reads it at boot, so restart after edits.

## 2. ANTHROPIC_API_KEY — the big one

**Get it:** <https://console.anthropic.com> → API keys → create key.

```
ANTHROPIC_API_KEY=sk-ant-...
```

**Unlocks:** intake triage, routing suggestions, exemption pass,
auto-classification, redaction suggestions, coordinator copilot, drafted
letters/replies, the portal requester agent, the `request_match` pre-filing
judge. All of it degrades honestly without the key, so nothing breaks
before this step — the AI layer just wakes up.

**Verify:** restart the dev server, file a request in the Riverton portal,
and watch the triage card appear on the request detail within ~a minute.

**⚠ Standing obligation — do this the same day:** `npm run eval` has NOT
been run since the `request_match` prompt shipped (2026-08-13, answer-first
phase 3; no key existed in that build environment). CLAUDE.md requires an
eval run + scorecard diff for prompt changes. Run:

```bash
npm run eval
```

and record the scorecard (compare against the last live one in HANDOFF:
exemption 5/5 · recall 100% · precision ~65–73%). If `request_match`
scores badly, its floors (requester 0.72 / staff 0.45 in
`priorAnswerService`) need retuning before trusting pre-filing deflection.

## 3. VOYAGE_API_KEY — real embeddings (optional but cheap)

**Get it:** <https://dash.voyageai.com> → API keys.

```
VOYAGE_API_KEY=pa-...
```

**Unlocks:** real semantic vectors for the hybrid answer box and duplicate
detection (deterministic fake vectors otherwise — search works either way,
it just gets smarter). **Verify:** ask the Riverton answer box something
phrased unlike any document title and check it still finds the record.

## 4. Email — outbound delivery and inbound replies

Outbox-only mode is fully functional (every message is recorded at
`/[agency]/app/outbox`); these make real mail move.

**Outbound — pick ONE provider:**
- Postmark: <https://postmarkapp.com> → server → API token
- Resend: <https://resend.com> → API key

```
EMAIL_FROM="Records Office <records@your-domain>"
POSTMARK_SERVER_TOKEN=...        # or RESEND_API_KEY=...
```

Both are spoken to fetch-only (no SDK). The sending domain needs the
provider's SPF/DKIM records — do that in DNS first or delivery bounces.
**Verify:** file a request with a real email address; the "received"
milestone email should arrive, and the delivery row on the outbox page
should show `relay_status: sent` (failures land on /admin Health).

**Inbound (responder email replies + requester clarifications by mail):**

```
INBOUND_EMAIL_TOKEN=$(openssl rand -hex 24)
INBOUND_EMAIL_DOMAIN=in.your-domain
```

Point the provider's inbound webhook at
`POST {your-url}/api/v1/email/inbound` with
`Authorization: Bearer $INBOUND_EMAIL_TOKEN` (endpoint 404s until the token
is set — that's the off switch). Inbound needs a publicly reachable URL, so
on a laptop this means a tunnel (e.g. `cloudflared tunnel --url
http://localhost:3000`) or skipping inbound until deployed. Set
`APP_BASE_URL` to whatever URL the outside world sees, or emailed links
point at localhost.

## 5. Optional local services — each one `brew install` or one container

- **Virus scanning beyond the builtin:** `brew install clamav` (or
  `docker run -p 3310:3310 clamav/clamav`), then `CLAMAV_HOST=localhost`.
  Builtin EICAR refusal works with zero services; clamd is the real engine.
  Verify: upload the EICAR test string → refused either way.
- **OCR for scans/photos:** `brew install tesseract` then
  `TESSERACT_PATH=tesseract` (or the `hertzg/tesseract-server` container +
  `OCR_ENDPOINT`). Verify: upload a photographed page; extracted text
  appears after the `ocr_extract` job runs, and the redaction studio stops
  saying "no OCR configured".
- **Search cluster:** `ELASTICSEARCH_URL` / `ELASTICSEARCH_INDEX` /
  `ELASTICSEARCH_API_KEY` route ranking through ES/OpenSearch, falling back
  to builtin BM25 on any error. See §6 — this adapter has never been run
  against a live cluster; the first setup that configures it is the test.
- **S3-compatible blobs:** all four `S3_*` vars (see `.env.example`);
  local FS is the default and fine for a laptop. See §6 before relying.

## 6. Verification debts — unproven paths, in priority order

Things that shipped code-complete but have never touched the live service.
Burning these down is part of setup on any machine that has the keys:

1. **`npm run eval` for `request_match`** — §2 above. Highest priority.
2. **MinIO round-trip.** `docker run -p 9000:9000 -p 9001:9001
   minio/minio server /data --console-address :9001`, create a bucket, set
   the four `S3_*` vars, restart, then run a full upload → redact → release
   → download cycle and confirm bytes and checksums survive. The SigV4
   signer is pinned against AWS's published example but has never spoken to
   a real MinIO.
3. **Elasticsearch live.** Start a single-node ES/OpenSearch container, set
   the env, seed, and confirm (a) results still come back, (b) killing the
   container silently falls back to builtin BM25, (c) nothing outside the
   scoped corpus ever surfaces (the adapter drops unknown ids — check the
   logs, not just the UI).

## 7. Docker deploy (the self-contained shape)

```bash
cp .env.example .env   # at minimum AUTH_SECRET + PLATFORM_ADMIN_*
docker compose up --build                  # → :3000
SEED_DEMO=true docker compose up --build   # …seeded at boot
```

One volume (`clerk-data` → `/data`) holds DB + blobs — the volume name is
deliberately still `clerk-data`; renaming it orphans existing deployments.
Seed ONLY via `SEED_DEMO=true` at boot — never `docker compose exec … npm
run seed` against a running container (two writers on one PGlite dir).

## 8. Setup gotchas (the ones that bite on a fresh machine)

- **One process per PGlite data dir.** No seeds/scripts while a dev server
  holds `./.pgdata`.
- **Restart the dev server** after changing any repository/adapter
  interface — memoized singletons survive HMR and make new methods
  "mysteriously" missing.
- **Reseeding invalidates staff sessions** (new user ids) — log in again.
- `npm run test:e2e` runs Playwright at `workers:1` on purpose (specs share
  a server + DB); needs Chromium (`npx playwright install chromium` once).
- **tsc noise from `.next/types`** after a crashed build: `rm -rf
  .next/types` and let the dev server regenerate.

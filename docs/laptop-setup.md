# Laptop & keys — copy/paste runbook

**How to read this file:** every step is either **CLICK** (an exact click
path) or **PASTE** (a block you copy verbatim — into a terminal, a settings
field, or a Claude session). Nothing here requires composing anything
yourself. Parts are independent; do them in any order, but the ⚡ checklist
first — it unblocks the most.

**The one rule: never commit a secret.** `.env` is gitignored — keep it
that way. Secrets live in exactly two places: your laptop's `.env`, and the
claude.ai environment settings. Everything else here produces committed
docs/HANDOFF updates, which the session you hand work to will do itself.

> **Maintenance guarantee (enforced in CLAUDE.md):** every push that adds
> or renames an env var, key, external service, or anything else requiring
> action from YOU must update this file in the same commit. If a variable
> exists in the codebase, this file tells you where to get its value and
> where to put it. If you catch a miss, say "laptop doc is stale" to any
> session and it must fix it before its next push.

---

## ⚡ Keep coding from your phone — do once, ~20 minutes

Everything already works from your phone EXCEPT model-powered work (the
eval, live AI verification, semantic search quality). These five steps fix
that permanently.

**1. CLICK — get the Anthropic key** (shown once; keep the tab open):

    console.anthropic.com → sign in → API keys → Create key → name: brandeis-dev → Copy

**2. CLICK — get the Voyage key** (free tier; optional but recommended):

    dash.voyageai.com → sign in → API keys → Create key → Copy

**3. CLICK + PASTE — put both where cloud sessions read them:**

    claude.ai → Settings → Code → [your Brandeis environment] → Environment variables → Add

   Two entries. Names exactly as below; values from steps 1–2:

```
ANTHROPIC_API_KEY
```
```
VOYAGE_API_KEY
```

**4. CLICK — check the environment's network policy** (same settings page):
   it must allow `api.anthropic.com` and `api.voyageai.com`. On "trusted"
   or broader you're done; on a custom allowlist, add those two hosts.

**5. ~~PASTE — hand the standing debt to a fresh session~~ DONE
   2026-08-13** (keyed laptop session: eval 27/27 recorded in HANDOFF,
   precedent citations proven live). If you ever bump a prompt again, the
   equivalent hand-off message is in Part B below.

That's it. New sessions (not already-open ones) see the keys. After this,
only Part C (Docker) and Part D (email + DNS) ever need you at a machine.

---

## Part A — mirror the keys into your laptop's `.env`

Only needed the first time you work on the laptop itself. **PASTE**
(replace the two values):

```bash
cd clerk
cat >> .env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-PASTE-YOURS
VOYAGE_API_KEY=pa-PASTE-YOURS
EOF
```

---

## Part B — the eval debt (if you didn't hand it off in ⚡ step 5)

**PASTE:**

```bash
cd clerk && npm run eval
```

What good looks like (last run 2026-08-13, all gates green): **custodian
8/8 · exemption 5/5, recall 100%, precision 69% · intake triage 7/8 (88%,
both RAG cases pass) · answer engine 3/3 grounded**. Note `request_match`
has no eval case of its own — the RAG golden cases cover the triage/
routing prompts; a misbehaving request_match needs a new golden set
first (see HANDOFF). Then either commit the
scorecard into HANDOFF yourself, or **PASTE** into a Claude session:

```
Here is the npm run eval scorecard output: <paste it>. Record it in a new
HANDOFF entry, clear the eval-debt lines from Known small gaps, retune the
priorAnswerService floors if request_match looks wrong, and push to main.
```

---

## Part C — prove the two unproven adapters (Docker required)

### C1. MinIO (the S3 blob adapter)

**PASTE — start MinIO and configure the app:**

```bash
docker run -d --name minio -p 9000:9000 -p 9001:9001 \
  minio/minio server /data --console-address ":9001"
cd clerk
cat >> .env << 'EOF'
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=brandeis-blobs
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_REGION=us-east-1
EOF
```

**CLICK — create the bucket:**

    localhost:9001 → sign in (minioadmin / minioadmin) → Buckets → Create bucket → name: brandeis-blobs

**PASTE — into a Claude Code session on this laptop** (or do it by hand:
file a request with an attachment → redact → finalize → download):

```
MinIO is live on localhost:9000 and .env has the S3_* vars. Verify the S3
adapter end to end: seed, run the dev server, push a full byte cycle
(upload → redaction burn → release → download), confirm checksums match
and the MinIO console shows the objects. Fix anything that breaks (the
SigV4 signer is src/adapters/s3BlobStore.ts), then update the HANDOFF
verification-debt line with today's date and push to main.
```

### C2. Elasticsearch (search ranking + fallback)

**PASTE — start ES and configure:**

```bash
docker run -d --name es -p 9200:9200 -e discovery.type=single-node \
  -e xpack.security.enabled=false docker.elastic.co/elasticsearch/elasticsearch:8.14.0
cd clerk
cat >> .env << 'EOF'
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX=brandeis-records
EOF
```

**PASTE — into a Claude Code session on this laptop:**

```
A single-node Elasticsearch is on localhost:9200 and .env points at it.
Verify the search adapter: (a) archive + staff search return results
through ES, (b) docker stop es makes search silently fall back to builtin
BM25 with no user-visible error, (c) nothing outside the scoped corpus
ever surfaces (check the adapter logs drop unknown ids). Fix what breaks,
update the HANDOFF verification-debt line with today's date, push to main.
```

---

## Part D — email (do when a real deployment nears; nothing blocks on it)

**1. CLICK — create ONE provider account and copy its key:**

    postmarkapp.com → create server → API Tokens → copy the Server API token
    — OR —
    resend.com → API keys → Create → copy

**2. CLICK — DNS:** add the provider's SPF + DKIM records to your sending
   domain (their setup page lists the exact records) BEFORE sending.

**3. PASTE — configure outbound** (pick the one matching your provider):

```bash
cd clerk
cat >> .env << 'EOF'
EMAIL_FROM="Records Office <records@your-domain.gov>"
POSTMARK_SERVER_TOKEN=PASTE-YOURS
EOF
```

**4. Inbound replies** additionally need a public URL. **PASTE:**

```bash
cat >> .env << 'EOF'
INBOUND_EMAIL_TOKEN=REPLACE-run: openssl rand -hex 24
INBOUND_EMAIL_DOMAIN=in.your-domain.gov
APP_BASE_URL=https://your-public-url
EOF
```

   Then **CLICK** in the provider: inbound webhook →
   `POST {APP_BASE_URL}/api/v1/email/inbound` with header
   `Authorization: Bearer <your INBOUND_EMAIL_TOKEN>`.

**5. Verify:** file a request with a real email → the "received" email
   arrives → reply to it → the reply appears on the request thread.

### D½. Private connected-source feeds (only if you register one)

Public open-data portals need nothing. If you register a private HTTP/
Socrata feed, the admin form asks for an env var NAME (e.g.
`CITY_PORTAL_TOKEN`) — then **PASTE**, with the real token, everywhere
syncs run (laptop `.env`, and claude.ai env settings for cloud sessions):

```
CITY_PORTAL_TOKEN=PASTE-THE-BEARER-TOKEN
```

Related, already documented in `.env.example`: `CONNECTED_DROP_PATH` moves
the per-agency file-drop directory (mount a volume in production; the
admin page displays the exact path to hand your IT department).

---

## Part E — fresh laptop from zero (~10 min, no accounts)

**PASTE, top to bottom:**

```bash
brew install node git
export PATH="/opt/homebrew/bin:$PATH"
git clone https://github.com/abhinemani/clerk.git && cd clerk
npm install
npm test
cp .env.example .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
npm run seed
npm run dev
```

Open <http://localhost:3000>. Everything works keyless except live AI,
real email, OCR (`brew install tesseract` + `TESSERACT_PATH=tesseract` in
`.env`), and clamd (`brew install clamav` + `CLAMAV_HOST=localhost`).

Sign-ins (the seed also prints these):

```
staff admin   dana@riverton.gov / riverton-demo
coordinator   casey@riverton.gov / riverton-demo2
responder     sam@riverton.gov / riverton-demo3
resident      jordan@rivertonledger.com / riverton-resident
console       admin@brandeis.example / brandeis-admin-dev
```

E2e (optional): `npx playwright install chromium && npm run test:e2e`

### If something is weird on a fresh machine

- `npm test` never reads `.env` (by design); only `npm run eval` does. The
  dev server reads it at boot — restart after edits.
- Never seed while a dev server is running (PGlite is single-writer).
- Restart the dev server after changing any repository/adapter interface.
- Reseeding invalidates staff sessions — sign in again.
- Phantom `MODULE_NOT_FOUND` / pages that never hydrate after long dev
  runs: `rm -rf .next`, restart. It is the bundler, not your code.

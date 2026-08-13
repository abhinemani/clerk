# Laptop sessions — what only you can do, and what to commit so cloud work continues

Rewritten 2026-08-13 (owner ask). Development on Brandeis mostly happens in
Claude Code **cloud sessions started from your phone or browser**. Those
sessions can build, test, and browser-verify everything offline — but they
have **no API keys, no OAuth browser, and no DNS access**. This file is the
complete list of what needs you at a real keyboard, written so each item ends
in something **committed to the repo or configured in claude.ai** that every
future cloud session can use. Work the parts in order; A unblocks the most.

**The one rule: never commit a secret.** `.env` is gitignored — keep it that
way. What IS committable: eval scorecards, HANDOFF status updates, docs, and
any code fix you make along the way. Keys go in exactly two places: your
laptop's `.env`, and the claude.ai environment settings (Part A).

---

## Part A — put keys where cloud sessions can use them (~15 min, highest value)

Cloud sessions currently skip everything AI-gated (eval, live triage
verification, copilot testing) because `ANTHROPIC_API_KEY` doesn't exist
there. Fix that once and every future phone-started session can do that work
for you.

1. **Get the Anthropic key:** <https://console.anthropic.com> → sign in →
   *API keys* → *Create key* → name it `brandeis-dev` → copy the `sk-ant-…`
   value now (it is shown once).
2. **Get the Voyage key (optional, ~2 min, free tier is fine):**
   <https://dash.voyageai.com> → *API keys* → create → copy the `pa-…` value.
   Real embeddings for the answer box and dedup; the deterministic fakes work
   without it, so this is a quality upgrade, not a blocker.
3. **Add both to the cloud environment:** <https://claude.ai> → *Settings* →
   *Code* → open the environment your Brandeis sessions run in → *Environment
   variables* → add:
   ```
   ANTHROPIC_API_KEY=sk-ant-…
   VOYAGE_API_KEY=pa-…        (if you made one)
   ```
   New sessions pick these up at start. (Docs, if the UI has moved:
   <https://code.claude.com/docs/en/claude-code-on-the-web>.)
4. **Add both to your laptop's `.env`** (created in Part E if you don't have
   one yet) — same two lines.
5. **Tell the next session.** Start a session from your phone and say "keys
   are in — run the eval" (Part B is exactly what it will do, and it can now
   do it without you).

**Commit/configure artifact:** nothing in the repo; the configured
environment IS the artifact. Everything below Part B can now also be done BY
a cloud session — do it yourself only if you're already at the laptop.

---

## Part B — the standing eval obligation (~10 min once keys exist)

CLAUDE.md requires an eval run + scorecard diff whenever a prompt changes.
The `request_match` prompt (answer-first phase 3) shipped 2026-08-13 with
**no eval ever run** — the build environment had no key. This is the oldest
open debt in HANDOFF.

```bash
cd clerk
npm run eval          # the ONLY command that reads .env; costs a few cents
```

1. Compare against the last recorded scorecard (HANDOFF, brand-window entry):
   **exemption 5/5 · recall 100% · precision ~65–73%**.
2. Look specifically at `request_match` (it never had a baseline). If its
   match/no-match calls look wrong, the deflection floors are the tuning
   knob: `requester 0.72 / staff 0.45` in `src/services/priorAnswerService.ts`
   — raise the requester floor if it over-matches (false "someone asked this
   before" is worse than a miss).
3. **Commit:** paste the full scorecard into HANDOFF under a dated entry,
   delete the "eval has NOT been run" line from Known small gaps, and commit
   with the scorecard summary in the message. If you changed a floor, that's
   part of the same commit, with the before/after numbers.

---

## Part C — prove the two unproven adapters (~30 min, Docker required)

Both shipped code-complete against specs and mocks; neither has touched the
real service. A cloud session wrote them; a session with Docker can prove
them. Each ends in a HANDOFF edit + commit that retires the gap line.

### C1. MinIO round-trip (the S3 adapter)

```bash
docker run -d --name minio -p 9000:9000 -p 9001:9001 \
  minio/minio server /data --console-address ":9001"
# console http://localhost:9001 (minioadmin/minioadmin) → create bucket "brandeis-blobs"
cat >> .env << 'EOV'
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=brandeis-blobs
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_REGION=us-east-1
EOV
npm run seed && npm run dev
```

Then exercise a **full byte cycle** in the browser: file a request with an
attachment → staff open it → redaction studio → finalize → download the
burned artifact → confirm the bytes open and the checksum event is in the
audit log. Also check the MinIO console shows the objects.

**Commit:** flip the HANDOFF line to "S3/MinIO adapter verified against live
MinIO (DATE): upload → burn → release → download round-trip clean." Any bug
you hit gets fixed in the same session — the SigV4 signer is
`src/adapters/blobStore.ts`.

### C2. Elasticsearch live + fallback

```bash
docker run -d --name es -p 9200:9200 -e discovery.type=single-node \
  -e xpack.security.enabled=false docker.elastic.co/elasticsearch/elasticsearch:8.14.0
echo 'ELASTICSEARCH_URL=http://localhost:9200' >> .env
echo 'ELASTICSEARCH_INDEX=brandeis-records' >> .env
npm run dev
```

Three checks: (a) archive/staff search still returns results (now ranked by
ES — watch the dev log for the adapter logging); (b) `docker stop es` →
search **silently falls back** to builtin BM25, no user-visible error;
(c) nothing outside the scoped corpus ever surfaces — the adapter drops
unknown ids; check the logs, not just the UI.

**Commit:** same pattern — flip the HANDOFF gap line with the date and what
you observed, fix anything that broke.

---

## Part D — accounts that need a human (email; do when a real deployment nears)

Nothing here blocks development; the outbox-first design means every message
is recorded and inspectable without a provider. Do this when real mail needs
to move.

1. **Pick one provider** and create the account:
   - Postmark: <https://postmarkapp.com> → create server → copy the *Server
     API token*.
   - Resend: <https://resend.com> → *API keys* → create.
2. **DNS:** add the provider's SPF + DKIM records to the sending domain
   before sending anything, or it bounces/spams.
3. `.env` (and the claude.ai environment, if you want cloud sessions to test
   delivery against a sandbox domain):
   ```
   EMAIL_FROM="Records Office <records@your-domain>"
   POSTMARK_SERVER_TOKEN=…        # or RESEND_API_KEY=…
   ```
4. **Inbound** (requester replies by email) additionally needs a publicly
   reachable URL — on a laptop that means a tunnel
   (`cloudflared tunnel --url http://localhost:3000`), plus:
   ```
   INBOUND_EMAIL_TOKEN=$(openssl rand -hex 24)
   INBOUND_EMAIL_DOMAIN=in.your-domain
   APP_BASE_URL=<the public URL>
   ```
   Point the provider's inbound webhook at
   `POST {APP_BASE_URL}/api/v1/email/inbound` with
   `Authorization: Bearer $INBOUND_EMAIL_TOKEN`.
5. **Verify:** file a request with a real address → "received" email arrives
   → outbox row shows `relay_status: sent`; reply to it → the reply appears
   on the request thread.

**Commit:** if any new env var or provider quirk surfaced, document it in
`.env.example` (names and comments only, never values) and note the
verification in HANDOFF.

---

## Part E — fresh-laptop baseline (~10 min, zero accounts)

The reference sequence for a machine with nothing on it:

```bash
brew install node git          # Homebrew node may need: export PATH="/opt/homebrew/bin:$PATH"
git clone https://github.com/abhinemani/clerk.git && cd clerk   # repo name is legacy; product is Brandeis
npm install
npm test                       # 745+ tests, offline — must pass before anything else
cp .env.example .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
npm run seed                   # City of Riverton + Bellmar demo (prints all credentials)
npm run dev                    # http://localhost:3000
npx playwright install chromium && npm run test:e2e   # optional; workers:1 on purpose
```

Everything works keyless except live AI, real email, OCR
(`brew install tesseract` + `TESSERACT_PATH=tesseract`), and clamd
(`brew install clamav` + `CLAMAV_HOST=localhost`) — each degrades honestly.

Demo logins (also printed by the seed): `dana@riverton.gov / riverton-demo`
(admin) · `casey@riverton.gov / riverton-demo2` · `sam@riverton.gov /
riverton-demo3` (responder) · resident `jordan@rivertonledger.com /
riverton-resident` · platform console `admin@brandeis.example /
brandeis-admin-dev` (overridden by `PLATFORM_ADMIN_*` in `.env` — check
before assuming).

### Gotchas that bite fresh machines

- `npm test` **never** reads `.env` (offline by design); only `npm run eval`
  does. The dev server reads it at boot — restart after edits.
- **One process per PGlite dir**: no seeding while a dev server holds
  `./.pgdata`.
- Restart the dev server after changing any repository/adapter interface —
  memoized singletons survive HMR.
- Reseeding invalidates staff sessions (new user ids) — sign in again.
- Weird `MODULE_NOT_FOUND` from dynamic imports, or tsc noise from
  `.next/types`, after long dev runs or crashed builds: `rm -rf .next` and
  restart — the dev bundler's state corrupts; it is not your code.

---

## Keeping this file honest

When a laptop session finishes any Part, its commit should (a) make the
result visible in HANDOFF, and (b) update or delete the corresponding
section here if the instructions drifted. A new env var anywhere in the
codebase gets a line in `.env.example` and, if it's key-shaped, a mention in
Part A or D — in the same commit that introduces it.

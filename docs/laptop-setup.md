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

**3. CLICK + PASTE — put both where cloud sessions read them** (this is
   NOT under Settings — it lives on the environment selector):

    claude.ai/code → click the cloud icon / environment name above the message box
    → hover your environment → gear icon (or "Add cloud environment" if none)
    → "Environment variables" box

   Two lines, `.env` style, values from steps 1–2:

```
CLOUD_ANTHROPIC_API_KEY=sk-ant-PASTE-YOURS
VOYAGE_API_KEY=pa-PASTE-YOURS
```

   ⚠ The Anthropic one must be named `CLOUD_ANTHROPIC_API_KEY`, NOT
   `ANTHROPIC_API_KEY` — the platform filters the plain name out of
   session env (the dialog warns it "won't be used to authenticate
   requests"), so under the plain name cloud sessions never see it. The
   `CLOUD_` alias passes through and the app/eval map it at boot
   (verified live 2026-08-15).

   ⚠ Cloud environments have no dedicated secrets store — values are
   readable by anyone who can use the environment. Fine for a personal
   dev key; never put production credentials here.

**4. CLICK — network access** (same dialog): `api.anthropic.com` is in
   the default "Trusted" list already. For Voyage, set the Network access
   dropdown to "Custom", add `api.voyageai.com` one domain per line, and
   tick "Also include default list of common package managers".

**5. ~~PASTE — hand the standing debt to a fresh session~~ DONE
   2026-08-13** (keyed laptop session: eval 27/27 recorded in HANDOFF,
   precedent citations proven live). If you ever bump a prompt again, the
   equivalent hand-off message is in Part B below.

That's it. New sessions see the keys — only sessions started AFTER saving
pick up variables; already-open ones keep the config they booted with.
After this, only Part C (Docker) and Part D (email + DNS) ever need you
at a machine.

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

What good looks like (last run 2026-08-15, all gates green on re-run):
**custodian 8/8 · exemption 5/5, recall 100% · intake triage 9/10 (90%,
all four RAG/play cases pass) · fulfillment plan 5/6 (83%) · answer
engine 3/3 grounded**. The exemption gate is zero-missed-labels and is
model-nondeterministic — a single missed name is worth one re-run before
treating it as a regression. Note `request_match`
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

## Part D¾ — platform console on a real deployment (only when one goes live)

The `/admin` console (the cross-tenant operator surface) refuses the demo
credentials in production — sign-in stays disabled until you set both vars.
Tenant portals and staff workspaces don't need this. **PASTE** into the
deployment's environment settings (e.g. Railway → your service → Variables),
with your own email and `openssl rand -base64 24` for the password:

```
PLATFORM_ADMIN_EMAIL=you@your-domain.gov
PLATFORM_ADMIN_PASSWORD=REPLACE-run: openssl rand -base64 24
```

**Who may open a tenant at `/signup`:** anyone, with any email address —
that is the default and needs no variable. Self-registrations show up in the
console labelled "self-service signup" (and flagged when the admin address
isn't a .gov), so you can see and delete a junk tenant. You only need one of
these two, and only if you want a different door — **PASTE** whichever
applies into the same Variables screen:

```
SELF_SIGNUP=off
```
Operator-only: hides `/signup` entirely; you onboard every agency from
`/admin`.

```
SIGNUP_REQUIRE_GOV_EMAIL=true
```
Restricts self-signup to `.gov` / `.mil` / state-local `.us` addresses. This
turns away real school districts, joint-powers authorities, and `.org`
jurisdictions — leave it unset unless you have a reason.

---

## Part D⅞ — walkthrough requests from the marketing site (optional)

The homepage's primary button ("Book a walkthrough") goes to `/demo`, which
has a built-in form. **This needs nothing from you** — every submission is
written to the database and listed on the `/admin` console under
"Walkthrough requests", on any deployment, with zero services configured.
Read them there.

Two optional upgrades:

**1. Get an email when one arrives.** Only works once Part D's email
provider is set (without it the console list is still the record). **PASTE**
into your `.env` and the deployment's Variables screen:

```
DEMO_NOTIFY_EMAIL=you@your-domain.com
```

The notification's Reply-To is the requester's own address, so replying goes
straight to them. If sending fails, the submission is still saved — delivery
is never allowed to lose a lead.

**2. Use a real calendar scheduler instead of the form.** If you'd rather
people grab a slot directly:

    CLICK — cal.com (or calendly.com) → create an event type
            ("Brandeis walkthrough", 30 min) → copy its public link

Then **PASTE** into your `.env` and the deployment's Variables screen:

```
DEMO_SCHEDULING_URL=https://cal.com/your-handle/walkthrough
```

Every "Book a walkthrough" button now links straight to your scheduler, and
`/demo` forwards there too (so old links still work). Unset it to go back to
the built-in form. Must start with `http://` or `https://` — anything else is
ignored on purpose.

**Verify:** with neither variable set, submit the form at
`http://localhost:3000/demo` → it appears at `http://localhost:3000/admin`
under "Walkthrough requests".

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

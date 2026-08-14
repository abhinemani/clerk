# Operations runbook — backup, restore, and storage

For the person who answers "what happens if the machine dies?" Everything here
was written for the self-contained deploy (one container, embedded PGlite,
local blobs) and notes where managed Postgres / S3 differ.

## What state exists, and where

| State | Self-contained location | Externalized option |
|---|---|---|
| Database (requests, audit log, users, jobs) | `clerk-data` volume → `/data/pgdata` (PGlite) | Managed Postgres via `DATABASE_URL` |
| Blobs (uploads, burned redactions, seals) | `clerk-data` volume → `/data/blobs` | S3/MinIO via `S3_*` env vars |
| Connected-source file drop (inbound CSVs) | `CONNECTED_DROP_PATH` (default `.dropbox/` under the app dir; in-container under `/data` if you pointed it there) | — (it's an inbox: files already synced are also documents+blobs, so the drop dir itself needs no backup — anything unsynced there at crash time simply syncs when re-dropped) |
| Secrets/config | `.env` | your secret manager |

Everything the product guarantees (append-only audit, released artifacts,
checksums) lives in the database + blob stores. The `.next` build cache and
the in-process queue hold nothing durable — jobs are rows in the database.
The `dataset_rows` table (connected-sources phase 3) is a rebuildable
projection of slice documents; it rides the database backup like everything
else, and even a partial loss self-heals on the next sync (the backfill
re-materializes rows from the documents' own stored text).

## A laptop / bare `npm run dev` deployment (no Docker)

The same two stores exist as plain directories next to the checkout:
`./.pgdata` (PGlite; override `PGLITE_PATH`) and `./.blobdata` (override
`BLOB_PATH`). Both are gitignored — **a laptop that only pushes code has NO
backup of its demo/pilot data.** To back up: stop the dev server (PGlite is
single-writer — a copy under a live server can be torn, same rule as the
container), then:

```bash
tar czf "brandeis-dev-$(date +%F).tar.gz" .pgdata .blobdata
```

Restore = stop the server, delete the two dirs, untar, restart. If real
agency data ever lives on a laptop, move it to the container or managed
deploy instead — laptops don't do nightly cron.

## Backup (self-contained deploy)

PGlite is single-writer: **stop the container before copying the data
directory**, or the copy can be torn.

```bash
docker compose stop app
docker run --rm -v clerk-data:/data -v "$PWD/backups:/backups" alpine \
  tar czf "/backups/brandeis-$(date +%F).tar.gz" -C /data .
docker compose start app
```

Expected downtime: seconds. Run it nightly from cron on the host. Keep at
least 14 dailies; test-restore monthly (below). The archive contains BOTH the
database and every blob — one file is the whole deployment's state.

## Restore (self-contained deploy)

```bash
docker compose down
docker volume rm clerk-data && docker volume create clerk-data
docker run --rm -v clerk-data:/data -v "$PWD/backups:/backups" alpine \
  tar xzf /backups/brandeis-YYYY-MM-DD.tar.gz -C /data
docker compose up -d
```

Verify after every restore (this is the monthly test):
1. Staff login works (sessions survive — user ids are in the backup).
2. A released request's **download link streams real bytes** (blobs intact).
3. `/admin` shows the expected agencies and request counts.
4. The Health section shows no failed jobs beyond those failed pre-backup.

### What a restore legally means (read before restoring to an old point)

- **The audit log is append-only forward, not restore-proof.** Restoring to
  an earlier backup rewinds `request_events`/`admin_events` — events after
  the backup point are GONE, and the log's evidentiary story now has a gap.
  Restore the NEWEST usable backup, record (outside the system: an email,
  a note in the agency's files) that a restore happened, when, and to which
  point, and expect to re-do the lost window's work with fresh events.
- **Retention and legal holds run on schedule.** A restore can resurrect a
  document the retention sweep already destroyed on purpose. After
  restoring an old backup, check `/admin` → the retention warnings and let
  the next nightly sweep re-run before treating the corpus as current — and
  if a document was destroyed under a retention schedule, deleting the
  resurrected copy again is the correct action, not a loss.
- **Released artifacts stay immutable** (invariant 8): a restore never
  edits a delivered release — checksums verify exactly as before, which is
  also your best integrity check that the blob half of a backup is sound
  (spot-verify one on `/{slug}/authenticity`).

### Keep a copy off the machine

The tarball lands in `$PWD/backups` on the same host that just died in this
runbook's opening question. Ship each nightly archive somewhere else —
`rclone copy backups/ remote:brandeis-backups`, an S3 bucket, or at minimum
a different physical disk. Backups the fire can reach are notes, not
backups. If the archives leave your custody (any cloud), encrypt first:
`age -r <recipient> -o backup.tar.gz.age backup.tar.gz` — they contain
unredacted originals and PII by definition.

## Backup (managed Postgres + S3)

```bash
pg_dump "$DATABASE_URL" --format=custom --file="brandeis-$(date +%F).dump"
# restore: pg_restore --clean --dbname="$DATABASE_URL" brandeis-YYYY-MM-DD.dump
```

Blobs on S3/MinIO: turn on bucket versioning and rely on the provider's
durability; no app-side blob backup needed. The database backup must still be
yours — RDS-style automated snapshots satisfy this.

No coordination between the two is required: blob keys stored in the database
are stable, and a blob without a database row is harmless garbage (never the
reverse — the database is always restored to a point EQUAL TO OR EARLIER than
the blob store, which only ever gains objects).

## Storage adapters

- **Local (default):** bytes under `BLOB_PATH` (`/data/blobs` in the
  container). Zero configuration.
- **S3/MinIO:** set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY` (+ `S3_REGION` if not us-east-1). Path-style
  requests, SigV4 signed in-process (no SDK). MinIO sidecar for
  docker-compose deployments:

  ```yaml
  minio:
    image: minio/minio
    command: server /data
    volumes: [minio-data:/data]
  ```

  Migrating local → S3: copy `/data/blobs/**` into the bucket preserving
  relative paths as keys (`mc mirror /data/blobs alias/brandeis-blobs`), then set
  the env vars and restart. Keys are identical in both stores.

## Job queue

Jobs are rows in the `jobs` table (durable across restarts; the worker
re-queues anything a dead process left "running"). Failed jobs stay visible
in `/admin` → Health. There is no separate queue infrastructure to back up or
monitor — the database backup covers it.

## Email

Outbound mail is outbox-FIRST: every message is a `deliveries` row before any
provider is called, so a provider outage loses nothing. Relay failures are
marked on the row and surface in `/admin` → Health; re-send from the agency's
outbox once the provider recovers.

# Operations runbook — backup, restore, and storage

For the person who answers "what happens if the machine dies?" Everything here
was written for the self-contained deploy (one container, embedded PGlite,
local blobs) and notes where managed Postgres / S3 differ.

## What state exists, and where

| State | Self-contained location | Externalized option |
|---|---|---|
| Database (requests, audit log, users, jobs) | `clerk-data` volume → `/data/pgdata` (PGlite) | Managed Postgres via `DATABASE_URL` |
| Blobs (uploads, burned redactions, seals) | `clerk-data` volume → `/data/blobs` | S3/MinIO via `S3_*` env vars |
| Secrets/config | `.env` | your secret manager |

Everything the product guarantees (append-only audit, released artifacts,
checksums) lives in those two stores. The `.next` build cache and the
in-process queue hold nothing durable — jobs are rows in the database.

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

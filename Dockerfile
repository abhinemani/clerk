# Clerk — self-contained single-container deploy.
#
# No external services required: the embedded PGlite database and local blob
# store live on ONE mounted volume (/data). Optional upgrades (managed
# Postgres, email delivery, AI keys) are env vars — see docker-compose.yml.
#
#   docker compose up --build          # → http://localhost:3000
#   SEED_DEMO=true docker compose up --build  # …with demo tenants seeded at boot
#
# The image keeps full source + node_modules so `npm run seed` (tsx) works
# in-container — favoring a working self-contained demo over image size.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Any build-time DB touch goes to a throwaway dir, never the runtime volume.
RUN PGLITE_PATH=/tmp/build-pgdata BLOB_PATH=/tmp/build-blobs npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PGLITE_PATH=/data/pgdata \
    BLOB_PATH=/data/blobs \
    PORT=3000
COPY --from=build /app ./
# The one writable path: database + blobs, owned by the unprivileged user.
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]

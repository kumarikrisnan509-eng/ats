# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------
# ATS image — bundles the Node backend AND the static prototype (app.html
# + src/ + styles.css). Nginx on the host (or in another container) serves
# the static files by `docker cp`-ing them out of this image at deploy time,
# OR by mounting the /app/static directory as a volume.
#
# Build context must be the project root (the folder containing app.html).
# ----------------------------------------------------------------------

# ---------- 1) deps stage ----------
FROM node:20-alpine AS deps
WORKDIR /app

# Native build deps for any npm packages that compile from source.
# Removed after install to keep the runtime image small.
RUN apk add --no-cache python3 make g++

# Copy only manifest first for better layer caching.
COPY deploy/backend/package.json deploy/backend/package-lock.json* ./
# `npm ci` if a lockfile is present, else `npm install`.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---------- 2) runtime stage ----------
FROM node:20-alpine AS runtime

# tini = PID 1 that forwards signals correctly. wget = healthcheck. dumb-init alternative.
RUN apk add --no-cache tini wget \
 && addgroup -S ats \
 && adduser  -S -G ats ats

WORKDIR /app

# Dependencies from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Backend source.
COPY deploy/backend/ ./

# Static frontend baked in. Nginx (host or sidecar) reads from here.
RUN mkdir -p /app/static
COPY app.html    /app/static/app.html
COPY styles.css  /app/static/styles.css
COPY src/        /app/static/src/

# Tighten permissions: ats owns code; static is world-readable so a sidecar can mount it.
RUN chown -R ats:ats /app && chmod -R a+rX /app/static

USER ats

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Healthcheck — surfaces in `docker ps` and `docker compose ps`.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","server.js"]

# OCI image labels (consumed by GHCR + tooling)
LABEL org.opencontainers.image.title="ats-backend"
LABEL org.opencontainers.image.description="ATS (rajasekarselvam.com) — Node backend + static cockpit prototype."
LABEL org.opencontainers.image.source="https://github.com/OWNER/REPO"
LABEL org.opencontainers.image.licenses="UNLICENSED"

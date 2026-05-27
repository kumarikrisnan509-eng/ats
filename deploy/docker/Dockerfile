# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------
# ATS image — bundles the Node backend AND the static prototype (app.html
# + src/ + styles.css). Nginx on the host (or in another container) serves
# the static files by `docker cp`-ing them out of this image at deploy time,
# OR by mounting the /app/static directory as a volume.
#
# Build context must be the project root (the folder containing app.html).
#
# Note: Playwright is NOT in this image. The auto-login flow runs as a
# host-side script (deploy/scripts/auto-login.js) so this image stays small.
# ----------------------------------------------------------------------

# ---------- 0) frontend transform stage ----------
# P3 (2026-05-13): pre-transform JSX -> JS with esbuild so the browser does
# not download Babel (~2MB) or compile in-browser. Same 52 script tags,
# same load order, same window globals. First paint drops ~3s.
# T-469 (audit-2026-05-26 infra M6): pinned to immutable digest.
# Multi-arch (amd64+arm64). Dependabot will PR digest bumps weekly.
# Original tag: node:20-alpine (multi-arch manifest, pushed 2026-04-15).
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS frontend-build
WORKDIR /work
RUN npm init -y >/dev/null && npm install --no-save esbuild@0.21.5
COPY src/ ./src/
COPY deploy/build/transform.js ./transform.js
RUN node transform.js
RUN test "$(ls out/src/*.js 2>/dev/null | wc -l)" -ge 30 || (echo "transform produced too few files" && exit 1)

# ---------- 1) deps stage ----------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
WORKDIR /app

# Native build deps for any npm packages that compile from source.
# Removed after install to keep the runtime image small.
RUN apk add --no-cache python3 make g++

# Copy only manifest first for better layer caching.
COPY deploy/backend/package.json deploy/backend/package-lock.json* ./
# `npm ci` if a lockfile is present, else `npm install`.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---------- 2) runtime stage ----------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runtime

# T-443 (audit-2026-05-26 infra M5): drop wget (~400KB + CVE surface).
# tini = PID 1 that forwards signals correctly. Healthcheck below uses
# node's built-in http module so no external binary needed.
RUN apk add --no-cache tini \
 && addgroup -S ats \
 && adduser  -S -G ats ats

WORKDIR /app

# Dependencies from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Backend source.
COPY deploy/backend/ ./

# Static frontend baked in. Nginx (host or sidecar) reads from here.
# src/ is the PRE-TRANSFORMED output from the frontend-build stage.
RUN mkdir -p /app/static
COPY app.html                              /app/static/app.html
COPY status.html                           /app/static/status.html
COPY docs.html                             /app/static/docs.html
COPY legal.html                            /app/static/legal.html
COPY styles.css                            /app/static/styles.css
COPY --from=frontend-build /work/out/src/  /app/static/src/

# Tighten permissions: ats owns code; static is world-readable so a sidecar can mount it.
RUN chown -R ats:ats /app && chmod -R a+rX /app/static

USER ats

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Healthcheck — surfaces in `docker ps` and `docker compose ps`.
# T-443 (audit-2026-05-26 infra M5): node-native healthcheck. No wget
# binary needed; uses the runtime's existing node interpreter.
# T-461 (audit-2026-05-26 infra L7): port reads from $PORT env (already
# set above) instead of hardcoded 8080, so a deploy that overrides PORT
# (custom port-forward, alternate compose setup) gets a working
# healthcheck. Falls back to 8080 if PORT is empty.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||'8080'; require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","server.js"]

# OCI image labels (consumed by GHCR + tooling)
LABEL org.opencontainers.image.title="ats-backend"
LABEL org.opencontainers.image.description="ATS (rajasekarselvam.com) — Node backend + static cockpit prototype."
LABEL org.opencontainers.image.source="https://github.com/kumarikrisnan509-eng/ats"
LABEL org.opencontainers.image.licenses="UNLICENSED"

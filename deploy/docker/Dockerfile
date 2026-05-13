# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------
# ATS image — Node backend + static frontend + Playwright runtime.
#
# Why Playwright base: the auto-login flow uses headless Chromium. Playwright's
# bundled Chromium needs glibc + a specific set of shared libs that aren't easy
# to maintain on Alpine. Microsoft publishes an official image with everything
# pre-installed for both amd64 and arm64.
#
# Image size is ~700 MB (vs ~100 MB on Alpine). Trade-off accepted: the
# backend is one container per VM and disk isn't tight.
# ----------------------------------------------------------------------

# ---------- 1) deps stage (smaller node image, faster npm install) ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY deploy/backend/package.json deploy/backend/package-lock.json* ./
# Playwright's npm package will download Chromium by default — we use the system
# Chromium from the runtime base image, so skip the download here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---------- 2) runtime stage (Playwright official image, has Chromium) ----------
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini wget ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r ats --gid=10001 \
 && useradd  -r -g ats --uid=10001 --home-dir=/app --shell=/usr/sbin/nologin ats

WORKDIR /app

# Bring in node_modules from the deps stage.
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
# Playwright base already has Chromium at this path; tell our code to use it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8080

# Healthcheck — surfaces in `docker ps` and `docker compose ps`.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server.js"]

LABEL org.opencontainers.image.title="ats-backend"
LABEL org.opencontainers.image.description="ATS (rajasekarselvam.com) — Node backend + cockpit + Playwright auto-login."
LABEL org.opencontainers.image.source="https://github.com/mohanapriya63085/ats"
LABEL org.opencontainers.image.licenses="UNLICENSED"

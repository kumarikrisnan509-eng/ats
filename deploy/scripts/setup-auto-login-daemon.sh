#!/usr/bin/env bash
# Tier 79: install the host-side auto-login daemon on the Oracle Cloud VM.
# Run as root (or with sudo). Idempotent — safe to re-run.
set -euo pipefail

DAEMON_DIR=/opt/ats-auto-login
ENV_FILE=/etc/ats/auto-login.env
SOCKET_DIR=/var/run/ats
LOG_DIR=/var/log/ats
BROWSERS_DIR="$DAEMON_DIR/browsers"
NPM_CACHE_DIR="$DAEMON_DIR/.npm-cache"

# 1. Ensure runtime user "ats" exists in docker group (no-op if already exists).
if ! id ats >/dev/null 2>&1; then
  useradd --system --shell /bin/false --home-dir /var/lib/ats --groups docker ats
fi

# 2. Directories owned by ats, including npm + Playwright cache locations.
install -d -o ats -g docker -m 0775 "$DAEMON_DIR" "$SOCKET_DIR" "$LOG_DIR" /etc/ats /var/lib/ats "$BROWSERS_DIR" "$NPM_CACHE_DIR"
chown -R ats:docker "$DAEMON_DIR"

# 3. Copy daemon + service unit (call this script from the dir that contains them).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install -o ats -g docker -m 0644 "$SCRIPT_DIR/auto-login-daemon.js" "$DAEMON_DIR/auto-login-daemon.js"
install -o root -g root -m 0644 "$SCRIPT_DIR/ats-auto-login-daemon.service" /etc/systemd/system/ats-auto-login-daemon.service

# 4. Generate or reuse shared token.
if [ ! -f "$ENV_FILE" ]; then
  TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 32)
  cat > "$ENV_FILE" <<E
AUTO_LOGIN_TOKEN=$TOKEN
AUTO_LOGIN_SOCKET=$SOCKET_DIR/auto-login.sock
PLAYWRIGHT_BROWSERS_PATH=$BROWSERS_DIR
E
  chmod 0640 "$ENV_FILE"; chown root:docker "$ENV_FILE"
  echo "Generated AUTO_LOGIN_TOKEN. Add to docker-compose env: $TOKEN"
else
  if ! grep -q '^PLAYWRIGHT_BROWSERS_PATH=' "$ENV_FILE"; then
    echo "PLAYWRIGHT_BROWSERS_PATH=$BROWSERS_DIR" >> "$ENV_FILE"
  fi
  echo "Reusing existing AUTO_LOGIN_TOKEN from $ENV_FILE"
fi

# 5. Run npm/npx as ats with HOME + npm_config_cache pointed at writable dirs
#    (existing ats user has $HOME=/opt/ats which it can't write to).
RUN_AS_ATS="sudo -u ats env HOME=$DAEMON_DIR npm_config_cache=$NPM_CACHE_DIR PLAYWRIGHT_BROWSERS_PATH=$BROWSERS_DIR"

cd "$DAEMON_DIR"
$RUN_AS_ATS npm init -y >/dev/null 2>&1 || true
$RUN_AS_ATS npm install --no-audit --no-fund playwright otplib

# Chromium download — explicit env path so it doesn't touch /opt/ats/.cache
$RUN_AS_ATS npx playwright install chromium

# Optional: install OS deps for headless Chromium (libnss3 etc). Best-effort, runs as root.
npx --yes playwright@latest install-deps chromium 2>/dev/null || true

# 6. systemd
systemctl daemon-reload
systemctl enable --now ats-auto-login-daemon
systemctl status ats-auto-login-daemon --no-pager

#!/usr/bin/env bash
# Tier 79: install the host-side auto-login daemon on the Oracle Cloud VM.
# Run as root (or with sudo). One-time setup.
set -euo pipefail

DAEMON_DIR=/opt/ats-auto-login
ENV_FILE=/etc/ats/auto-login.env
SOCKET_DIR=/var/run/ats
LOG_DIR=/var/log/ats

# 1. Ensure runtime user "ats" exists in docker group.
if ! id ats >/dev/null 2>&1; then
  useradd --system --shell /bin/false --home-dir /var/lib/ats --groups docker ats
fi

# 2. Directories
install -d -o ats -g docker -m 0775 "$DAEMON_DIR" "$SOCKET_DIR" "$LOG_DIR" /etc/ats /var/lib/ats

# 3. Copy daemon + service unit (call this script from the dir that contains them).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install -o ats -g docker -m 0644 "$SCRIPT_DIR/auto-login-daemon.js" "$DAEMON_DIR/auto-login-daemon.js"
install -o root -g root -m 0644 "$SCRIPT_DIR/ats-auto-login-daemon.service" /etc/systemd/system/ats-auto-login-daemon.service

# 4. Generate a shared token if env file doesn't exist.
if [ ! -f "$ENV_FILE" ]; then
  TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 32)
  cat > "$ENV_FILE" <<E
AUTO_LOGIN_TOKEN=$TOKEN
AUTO_LOGIN_SOCKET=$SOCKET_DIR/auto-login.sock
E
  chmod 0640 "$ENV_FILE"
  chown root:docker "$ENV_FILE"
  echo "Generated AUTO_LOGIN_TOKEN. Add to docker-compose env: $TOKEN"
fi

# 5. Install Node deps INTO the daemon dir.
cd "$DAEMON_DIR"
npm init -y >/dev/null 2>&1 || true
npm install --no-audit --no-fund playwright otplib
sudo -u ats npx playwright install chromium

# 6. systemd
systemctl daemon-reload
systemctl enable --now ats-auto-login-daemon
systemctl status ats-auto-login-daemon --no-pager

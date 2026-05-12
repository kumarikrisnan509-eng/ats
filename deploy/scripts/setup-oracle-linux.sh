#!/usr/bin/env bash
# setup-oracle-linux.sh
#
# One-shot bootstrap for the ATS VM on Oracle Cloud Linux 9.
# Run as root (or with sudo):
#   sudo bash setup-oracle-linux.sh
#
# Idempotent: safe to re-run.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "This script must run as root. Try: sudo bash $0"
    exit 1
fi

DOMAIN="${DOMAIN:-rajasekarselvam.com}"
SERVICE_USER="ats"
STATIC_ROOT="/var/www/${DOMAIN}"
BACKEND_DIR="/opt/ats/backend"
ETC_DIR="/etc/ats"
LOG_DIR="/var/log/ats"
TOKENS_DIR="/var/lib/ats/tokens"
MASTER_KEY="/etc/ats/master.key"

echo "==> [1/9] System update"
dnf -y update

echo "==> [2/9] Install Nginx, Certbot, tools"
dnf -y install nginx certbot python3-certbot-nginx rsync firewalld policycoreutils-python-utils git tar

echo "==> [3/9] Install Node.js 20 LTS (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf -y install nodejs
fi
node -v
npm -v

echo "==> [4/9] Firewall: open 80, 443. Keep SSH restricted at OCI Security List."
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload

echo "==> [5/9] Service user & directories"
id -u "${SERVICE_USER}" >/dev/null 2>&1 || useradd --system --home-dir /opt/ats --shell /sbin/nologin "${SERVICE_USER}"
install -d -m 755 -o root -g root "/opt/ats"
install -d -m 755 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${BACKEND_DIR}"
install -d -m 755 -o root -g root "${STATIC_ROOT}"
install -d -m 755 -o root -g root /var/www/letsencrypt
install -d -m 750 -o root -g "${SERVICE_USER}" "${ETC_DIR}"
install -d -m 750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${LOG_DIR}"
install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${TOKENS_DIR}"

# 5b: master key for libsodium token vault (only generated if absent — never overwrite).
if [[ ! -f "${MASTER_KEY}" ]]; then
    echo "    -> generating ${MASTER_KEY} (one-time)"
    # Use openssl directly so we don't need node yet.
    openssl rand 32 > "${MASTER_KEY}"
    chmod 400 "${MASTER_KEY}"
    chown root:"${SERVICE_USER}" "${MASTER_KEY}"
    chmod 440 "${MASTER_KEY}"
else
    echo "    -> ${MASTER_KEY} already exists; leaving alone"
fi

echo "==> [6/9] SELinux contexts for /var/www and /var/log/ats"
if command -v semanage >/dev/null 2>&1; then
    semanage fcontext -a -t httpd_sys_content_t "${STATIC_ROOT}(/.*)?" 2>/dev/null || true
    restorecon -Rv "${STATIC_ROOT}" || true
fi
# Allow Nginx to proxy to loopback :8080
setsebool -P httpd_can_network_connect 1 || true

echo "==> [7/9] Nginx config"
# Expect the repo-copy of nginx/rajasekarselvam.com.conf to be next to this script.
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
NGINX_CONF_SRC="${SCRIPT_DIR}/../nginx/${DOMAIN}.conf"
if [[ -f "${NGINX_CONF_SRC}" ]]; then
    install -m 644 "${NGINX_CONF_SRC}" "/etc/nginx/conf.d/${DOMAIN}.conf"
else
    echo "!! nginx config not found at ${NGINX_CONF_SRC}. Copy it manually to /etc/nginx/conf.d/."
fi

# Harmless placeholder certs so Nginx starts before certbot runs.
# Certbot will overwrite these.
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    install -d "/etc/letsencrypt/live/${DOMAIN}"
    # Temporary self-signed so nginx -t passes on first boot.
    openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
        -keyout "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" \
        -out    "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" \
        -subj   "/CN=${DOMAIN}" >/dev/null 2>&1 || true
    # Options file certbot expects
    [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]] || cat > /etc/letsencrypt/options-ssl-nginx.conf <<'EOF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
EOF
    [[ -f /etc/letsencrypt/ssl-dhparams.pem ]] || openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048 >/dev/null 2>&1 || true
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> [8/9] systemd unit for ats-backend"
SVC_SRC="${SCRIPT_DIR}/../systemd/ats-backend.service"
if [[ -f "${SVC_SRC}" ]]; then
    install -m 644 "${SVC_SRC}" /etc/systemd/system/ats-backend.service
else
    echo "!! systemd unit not found at ${SVC_SRC}. Copy manually."
fi

# Seed /etc/ats/backend.env if it doesn't exist.
if [[ ! -f "${ETC_DIR}/backend.env" ]]; then
    ENV_SRC="${SCRIPT_DIR}/../backend/.env.example"
    if [[ -f "${ENV_SRC}" ]]; then
        install -m 600 -o root -g "${SERVICE_USER}" "${ENV_SRC}" "${ETC_DIR}/backend.env"
        echo "    seeded ${ETC_DIR}/backend.env from .env.example. Review it before starting the service."
    fi
fi

systemctl daemon-reload

echo "==> [9/9] Next steps"
cat <<MSG

Setup complete on this VM.

Next:
  1) Make sure ${DOMAIN} A-record points to this VM's public IP.
  2) Run the deploy script from your laptop:
       bash deploy/scripts/deploy.sh <server-user>@<server-ip>
     That rsyncs app.html, styles.css, src/, and backend/ to the server.
  3) Issue real TLS certs:
       sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}
  4) Start the backend:
       sudo systemctl enable --now ats-backend
  5) Verify:
       curl -I https://${DOMAIN}/
       curl    https://${DOMAIN}/api/health

Remember: KILL_SWITCH defaults to true. That is correct. Flip only when you
intentionally enable broker wiring later.
MSG

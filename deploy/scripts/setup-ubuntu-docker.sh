#!/usr/bin/env bash
# setup-ubuntu-docker.sh
#
# One-shot bootstrap for the ATS VM on Ubuntu (tested on 22.04 LTS and 24.04 LTS,
# Ampere ARM64 or x86_64). Run as root on the VM:
#
#   sudo bash setup-ubuntu-docker.sh
#
# Idempotent — safe to re-run.
#
# After this script you will have:
#   - Nginx with a server block for ats.rajasekarselvam.com
#   - Certbot (TLS issuance you trigger after DNS is confirmed)
#   - Docker Engine + compose plugin
#   - `deployer` user (in docker group, narrow sudoers for nginx-reload + static-swap)
#   - /opt/ats/compose/docker-compose.yml + /opt/ats/scripts/deploy-on-vm.sh
#   - /etc/ats/master.key (440 root:ats) + seeded /etc/ats/backend.env
#   - /var/lib/ats/tokens (700 ats:ats) + /var/log/ats (750 ats:ats)
#   - /var/www/ats.rajasekarselvam.com (empty until first deploy fills it)
#   - UFW configured to allow 22, 80, 443 (XRDP 3389 / VNC 5900 left untouched if present)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Run as root: sudo bash $0"
    exit 1
fi

DOMAIN="${DOMAIN:-ats.rajasekarselvam.com}"
SERVICE_USER="ats"
DEPLOY_USER="deployer"
STATIC_ROOT="/var/www/${DOMAIN}"
COMPOSE_DIR="/opt/ats/compose"
SCRIPTS_DIR="/opt/ats/scripts"
ETC_DIR="/etc/ats"
LOG_DIR="/var/log/ats"
TOKENS_DIR="/var/lib/ats/tokens"
MASTER_KEY="/etc/ats/master.key"

# ---------- 1) apt base ----------
echo "==> [1/9] apt update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    nginx certbot python3-certbot-nginx rsync ufw \
    ca-certificates curl gnupg lsb-release openssl

# ---------- 2) Docker Engine ----------
echo "==> [2/9] Docker Engine + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    UB_CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${UB_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y --no-install-recommends \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker --version
docker compose version

# ---------- 3) Firewall (ufw) ----------
echo "==> [3/9] ufw"
ufw --force reset >/dev/null
# Keep SSH open during ufw enable so we don't lock ourselves out.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
# XRDP and VNC — keep open since the user uses them to drive XFCE.
# Lock these down to specific source IPs in the OCI Security List, not here.
ufw allow 3389/tcp
ufw allow 5900/tcp
ufw --force enable
ufw status verbose

# ---------- 4) Users ----------
echo "==> [4/9] users"
id -u "${SERVICE_USER}" >/dev/null 2>&1 || \
    useradd --system --home-dir /opt/ats --shell /usr/sbin/nologin "${SERVICE_USER}"

if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"

# Install the GitHub-Actions deploy public key. Idempotent.
DEPLOYER_PUBKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIWnY09RubaEAvP5Q0/j0wUtzyKKZTclHiDEMUWuP+Hi github-actions@rajasekarselvam.com'
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
AUTH_KEYS="/home/${DEPLOY_USER}/.ssh/authorized_keys"
touch "${AUTH_KEYS}"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${AUTH_KEYS}"
chmod 600 "${AUTH_KEYS}"
if ! grep -qxF "${DEPLOYER_PUBKEY}" "${AUTH_KEYS}"; then
    echo "${DEPLOYER_PUBKEY}" >> "${AUTH_KEYS}"
    echo "    installed deployer public key"
fi

# Narrow sudoers — deployer can only do exactly the post-deploy steps it needs.
cat > /etc/sudoers.d/ats-deployer <<EOF
${DEPLOY_USER} ALL=(root) NOPASSWD: \\
    /usr/sbin/nginx -t, \\
    /bin/systemctl reload nginx, \\
    /bin/rm -rf /var/www/${DOMAIN}, \\
    /bin/rm -rf /var/www/${DOMAIN}.new, \\
    /bin/rm -rf /var/www/${DOMAIN}.old, \\
    /bin/mkdir -p /var/www/${DOMAIN}.new, \\
    /bin/mv /var/www/${DOMAIN} /var/www/${DOMAIN}.old, \\
    /bin/mv /var/www/${DOMAIN}.new /var/www/${DOMAIN}, \\
    /bin/mv /var/www/${DOMAIN}.old /var/www/${DOMAIN}, \\
    /bin/chown -R ${DEPLOY_USER}\\:${DEPLOY_USER} /var/www/${DOMAIN}.new
EOF
chmod 440 /etc/sudoers.d/ats-deployer
visudo -c -q -f /etc/sudoers.d/ats-deployer

# ---------- 5) Directories ----------
echo "==> [5/9] directories"
install -d -m 755 -o root            -g root             "/opt/ats"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${COMPOSE_DIR}"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${SCRIPTS_DIR}"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${STATIC_ROOT}"
install -d -m 755 -o root            -g root             /var/www/letsencrypt
install -d -m 750 -o root            -g "${SERVICE_USER}" "${ETC_DIR}"
install -d -m 750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${LOG_DIR}"
install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${TOKENS_DIR}"

# ---------- 6) master.key + seeded /etc/ats/backend.env ----------
echo "==> [6/9] master key + backend env"
if [[ ! -f "${MASTER_KEY}" ]]; then
    openssl rand 32 > "${MASTER_KEY}"
    chown root:"${SERVICE_USER}" "${MASTER_KEY}"
    chmod 440 "${MASTER_KEY}"
    echo "    generated ${MASTER_KEY}"
fi

if [[ ! -f "${ETC_DIR}/backend.env" ]]; then
    cat > "${ETC_DIR}/backend.env" <<EOF
ENV_NAME=prod
PORT=8080
KILL_SWITCH=true
AUDIT_LOG=/var/log/ats/audit.log
MAX_WS_CLIENTS=200
BROKER=mock
DEFAULT_SYMBOLS=NIFTY 50,BANKNIFTY,RELIANCE,HDFCBANK,TCS,INFY
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
ZERODHA_REDIRECT_URL=https://${DOMAIN}/api/brokers/zerodha/callback
MASTER_KEY_PATH=/run/secrets/master.key
TOKENS_DIR=/var/lib/ats/tokens
SESSION_SECRET=$(openssl rand -base64 32)
EOF
    chown root:"${SERVICE_USER}" "${ETC_DIR}/backend.env"
    chmod 640 "${ETC_DIR}/backend.env"
    echo "    seeded ${ETC_DIR}/backend.env — fill ZERODHA_* later when you wire live data"
fi

# ---------- 7) Install compose + deploy-on-vm.sh ----------
echo "==> [7/9] compose + deploy script"
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
DC_SRC="${SCRIPT_DIR}/../docker/docker-compose.yml"
SH_SRC="${SCRIPT_DIR}/deploy-on-vm.sh"

if [[ -f "${DC_SRC}" ]]; then
    install -m 644 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DC_SRC}" "${COMPOSE_DIR}/docker-compose.yml"
fi
if [[ -f "${SH_SRC}" ]]; then
    install -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${SH_SRC}" "${SCRIPTS_DIR}/deploy-on-vm.sh"
fi

# ---------- 8) Nginx config (ats.rajasekarselvam.com) ----------
echo "==> [8/9] nginx config"
NGINX_SRC="${SCRIPT_DIR}/../nginx/${DOMAIN}.conf"
NGINX_DST="/etc/nginx/sites-available/${DOMAIN}.conf"

# Disable the default Ubuntu Nginx site if present (it grabs port 80 for "Welcome to nginx").
rm -f /etc/nginx/sites-enabled/default

if [[ -f "${NGINX_SRC}" ]]; then
    install -m 644 "${NGINX_SRC}" "${NGINX_DST}"
    ln -sf "${NGINX_DST}" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
fi

# Always-present files Nginx needs.
mkdir -p /etc/letsencrypt

# options-ssl-nginx.conf (Certbot will overwrite this with its own when it issues a real cert).
if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
    cat > /etc/letsencrypt/options-ssl-nginx.conf <<'NGCONF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
NGCONF
    echo "    wrote /etc/letsencrypt/options-ssl-nginx.conf"
fi

# ssl-dhparams.pem (Certbot will reuse this).
if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
    echo "    generating dhparams (this takes ~30s)"
    openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048 >/dev/null 2>&1 || true
fi

# Self-signed placeholder cert so Nginx boots before Certbot.
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    mkdir -p "/etc/letsencrypt/live/${DOMAIN}"
    openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
        -keyout "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" \
        -out    "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" \
        -subj   "/CN=${DOMAIN}" >/dev/null 2>&1 || true
    echo "    wrote placeholder cert at /etc/letsencrypt/live/${DOMAIN}/"
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

# ---------- 9) Next steps ----------
echo "==> [9/9] Done."
cat <<MSG

Ubuntu VM bootstrap complete.

Next steps you do from your laptop / from GitHub:

1. Add the deployer SSH public key to /home/${DEPLOY_USER}/.ssh/authorized_keys:

     sudo -u ${DEPLOY_USER} mkdir -p /home/${DEPLOY_USER}/.ssh
     sudo -u ${DEPLOY_USER} chmod 700 /home/${DEPLOY_USER}/.ssh
     echo '<PASTE deployer.pub HERE>' | sudo -u ${DEPLOY_USER} tee -a /home/${DEPLOY_USER}/.ssh/authorized_keys
     sudo -u ${DEPLOY_USER} chmod 600 /home/${DEPLOY_USER}/.ssh/authorized_keys

2. From your laptop, capture the host key for the GitHub Secret OCI_SSH_KNOWN_HOSTS:

     ssh-keyscan -H ${DOMAIN}             # once DNS resolves
     # or, by IP:  ssh-keyscan -H <vm-ip>

3. Issue real TLS certs (DNS must point ${DOMAIN} -> this VM first):

     sudo certbot --nginx -d ${DOMAIN} --agree-tos -m you@${DOMAIN} --redirect --no-eff-email

4. Push to main and watch GitHub Actions. The deploy job will:
     - docker login to ghcr.io
     - docker pull ghcr.io/<owner>/ats-backend:<sha>
     - docker cp static files into ${STATIC_ROOT}/
     - docker compose up -d
     - reload Nginx
     - health-check the public endpoint

5. Verify:
     curl https://${DOMAIN}/api/health

Kill switch defaults true. Flip via:
     sudo sed -i 's/^KILL_SWITCH=.*/KILL_SWITCH=false/' /etc/ats/backend.env
     sudo systemctl restart ats-backend  # or restart the container

MSG

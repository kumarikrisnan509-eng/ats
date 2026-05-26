#!/usr/bin/env bash
# setup-oracle-linux-docker.sh
#
# v2 bootstrap for the Oracle Cloud Linux VM, optimised for the GitHub-Actions
# Docker deploy flow. Run once, as root:
#
#   sudo bash setup-oracle-linux-docker.sh
#
# Idempotent: safe to re-run.
#
# After this script, on this VM you will have:
#   - Nginx (TLS via Certbot), serving /var/www/rajasekarselvam.com
#   - Docker Engine + compose plugin
#   - `deployer` user (no shell sudo, but allowed to run docker + a few helper commands)
#   - /opt/ats/compose/docker-compose.yml in place
#   - /opt/ats/scripts/deploy-on-vm.sh in place (GH Actions calls it)
#   - /etc/ats/master.key + /etc/ats/backend.env + /var/lib/ats/tokens/ + /var/log/ats/

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Run as root: sudo bash $0"
    exit 1
fi

DOMAIN="${DOMAIN:-rajasekarselvam.com}"
SERVICE_USER="ats"
DEPLOY_USER="deployer"
STATIC_ROOT="/var/www/${DOMAIN}"
COMPOSE_DIR="/opt/ats/compose"
SCRIPTS_DIR="/opt/ats/scripts"
ETC_DIR="/etc/ats"
LOG_DIR="/var/log/ats"
TOKENS_DIR="/var/lib/ats/tokens"
MASTER_KEY="/etc/ats/master.key"

# -------- 1) System update + base packages --------
echo "==> [1/10] dnf update + base packages"
dnf -y update
dnf -y install nginx certbot python3-certbot-nginx rsync firewalld \
    policycoreutils-python-utils git tar openssl

# -------- 2) Docker Engine + compose plugin --------
echo "==> [2/10] Docker Engine"
if ! command -v docker >/dev/null 2>&1; then
    dnf -y install dnf-plugins-core
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker --version
docker compose version

# -------- 3) Firewall --------
echo "==> [3/10] firewalld"
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload

# -------- 4) Service + deploy users --------
echo "==> [4/10] users"
id -u "${SERVICE_USER}" >/dev/null 2>&1 || \
    useradd --system --home-dir /opt/ats --shell /sbin/nologin "${SERVICE_USER}"

if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
fi

# deployer must be in docker group to run `docker compose` without sudo.
usermod -aG docker "${DEPLOY_USER}"

# Allow deployer to reload nginx and chown static files (used by deploy-on-vm.sh) — narrow sudoers.
cat > /etc/sudoers.d/ats-deployer <<EOF
${DEPLOY_USER} ALL=(root) NOPASSWD: \\
    /usr/bin/nginx -t, \\
    /usr/bin/systemctl reload nginx, \\
    /usr/bin/rm -rf /var/www/${DOMAIN}, \\
    /usr/bin/rm -rf /var/www/${DOMAIN}.new, \\
    /usr/bin/rm -rf /var/www/${DOMAIN}.old, \\
    /usr/bin/mkdir -p /var/www/${DOMAIN}.new, \\
    /usr/bin/mv /var/www/${DOMAIN} /var/www/${DOMAIN}.old, \\
    /usr/bin/mv /var/www/${DOMAIN}.new /var/www/${DOMAIN}, \\
    /usr/bin/mv /var/www/${DOMAIN}.old /var/www/${DOMAIN}, \\
    /usr/bin/chown -R root\\:root /var/www/${DOMAIN}, \\
    /usr/bin/find /var/www/${DOMAIN} -type d -exec chmod 755 {} +, \\
    /usr/bin/find /var/www/${DOMAIN} -type f -exec chmod 644 {} +, \\
    /usr/sbin/restorecon -Rq /var/www/${DOMAIN}
EOF
chmod 440 /etc/sudoers.d/ats-deployer

# -------- 5) Directories --------
echo "==> [5/10] directories"
install -d -m 755 -o root           -g root            "/opt/ats"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${COMPOSE_DIR}"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${SCRIPTS_DIR}"
install -d -m 755 -o root           -g root            "${STATIC_ROOT}"
install -d -m 755 -o root           -g root            /var/www/letsencrypt
install -d -m 750 -o root           -g "${SERVICE_USER}" "${ETC_DIR}"
install -d -m 750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${LOG_DIR}"
install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${TOKENS_DIR}"

# -------- 6) master.key + .env --------
echo "==> [6/10] master key + backend env"
if [[ ! -f "${MASTER_KEY}" ]]; then
    openssl rand 32 > "${MASTER_KEY}"
    chown root:"${SERVICE_USER}" "${MASTER_KEY}"
    chmod 440 "${MASTER_KEY}"
    echo "    generated ${MASTER_KEY}"
fi

if [[ ! -f "${ETC_DIR}/backend.env" ]]; then
    cat > "${ETC_DIR}/backend.env" <<'EOF'
ENV_NAME=prod
PORT=8080
KILL_SWITCH=true
AUDIT_LOG=/var/log/ats/audit.log
MAX_WS_CLIENTS=200
BROKER=mock
DEFAULT_SYMBOLS=NIFTY 50,BANKNIFTY,RELIANCE,HDFCBANK,TCS,INFY
# Filled in by you after creating a Kite Connect app:
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
ZERODHA_REDIRECT_URL=https://rajasekarselvam.com/api/brokers/zerodha/callback
MASTER_KEY_PATH=/run/secrets/master.key
TOKENS_DIR=/var/lib/ats/tokens
# T-443 (audit-2026-05-26 vm-scripts M2): real random secret per install.
# Previously this was the literal "CHANGE-ME-BASE64" which the operator was
# expected to edit manually before first boot; if they forgot, the backend
# booted with an attacker-known SESSION_SECRET and session-cookie forgery
# was trivial. Now we generate it at script-run time so a clean install
# is safe-by-default.
SESSION_SECRET=__SESSION_SECRET_GENERATED__
EOF
    # Replace the placeholder line with a freshly-rolled 48-byte base64
    # secret. Done AFTER the heredoc to keep the heredoc readable.
    GEN_SECRET=$(openssl rand -base64 48 | tr -d '\n')
    sed -i "s|SESSION_SECRET=__SESSION_SECRET_GENERATED__|SESSION_SECRET=${GEN_SECRET}|" "${ETC_DIR}/backend.env"
    chown root:"${SERVICE_USER}" "${ETC_DIR}/backend.env"
    chmod 640 "${ETC_DIR}/backend.env"
    echo "    seeded ${ETC_DIR}/backend.env — edit to add ZERODHA keys later"
fi

# -------- 7) SELinux toggles --------
echo "==> [7/10] SELinux"
setsebool -P httpd_can_network_connect 1 || true
setsebool -P container_manage_cgroup   1 || true

# -------- 8) docker compose file + deploy script --------
echo "==> [8/10] compose + deploy script"
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
DC_SRC="${SCRIPT_DIR}/../docker/docker-compose.yml"
SH_SRC="${SCRIPT_DIR}/deploy-on-vm.sh"

if [[ -f "${DC_SRC}" ]]; then
    install -m 644 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DC_SRC}" "${COMPOSE_DIR}/docker-compose.yml"
fi
if [[ -f "${SH_SRC}" ]]; then
    install -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${SH_SRC}" "${SCRIPTS_DIR}/deploy-on-vm.sh"
fi

# -------- 9) Nginx config --------
echo "==> [9/10] nginx config"
NGINX_SRC="${SCRIPT_DIR}/../nginx/${DOMAIN}.conf"
if [[ -f "${NGINX_SRC}" ]]; then
    install -m 644 "${NGINX_SRC}" "/etc/nginx/conf.d/${DOMAIN}.conf"
fi
# Self-signed placeholder so Nginx boots before certbot.
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    mkdir -p "/etc/letsencrypt/live/${DOMAIN}"
    openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
        -keyout "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" \
        -out    "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" \
        -subj   "/CN=${DOMAIN}" >/dev/null 2>&1 || true
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

# -------- 10) Next-step prompt --------
echo "==> [10/10] Done."
cat <<MSG

VM is ready for the GitHub-Actions Docker flow.

To finish setup:

1. Add the deploy user's authorized_keys.
   Generate a keypair LOCALLY (e.g. on your laptop):
     ssh-keygen -t ed25519 -f ats-deploy -C "github-actions@rajasekarselvam.com"
   Then on this VM:
     sudo -u ${DEPLOY_USER} mkdir -p /home/${DEPLOY_USER}/.ssh
     sudo -u ${DEPLOY_USER} chmod 700 /home/${DEPLOY_USER}/.ssh
     echo '<contents of ats-deploy.pub>' | sudo -u ${DEPLOY_USER} tee -a /home/${DEPLOY_USER}/.ssh/authorized_keys
     sudo -u ${DEPLOY_USER} chmod 600 /home/${DEPLOY_USER}/.ssh/authorized_keys

2. Add GitHub Secrets in your repo (Settings → Secrets and variables → Actions):
     OCI_SSH_HOST          = <this VM's public IP or rajasekarselvam.com>
     OCI_SSH_USER          = ${DEPLOY_USER}
     OCI_SSH_PRIVATE_KEY   = <contents of the private key file ats-deploy>
     OCI_SSH_KNOWN_HOSTS   = <output of: ssh-keyscan -H rajasekarselvam.com>
     GHCR_PULL_TOKEN       = <a fine-grained PAT with read:packages scope>

3. Issue real TLS:
     sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}

4. Push to main. GitHub Actions will build, push to GHCR, and deploy here.

5. Verify:
     curl https://${DOMAIN}/api/health

MSG

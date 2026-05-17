#!/usr/bin/env bash
# ============================================================
#  sync-nginx-config.sh — T99-T41 one-time install.
#
#  Copies the latest nginx configs from /opt/ats/scripts/nginx-staged/
#  (which the deploy workflow scps into) to /etc/nginx/sites-available/,
#  tests, and reloads.
#
#  Runs as root via sudo. Idempotent.
#
#  Usage:
#    sudo /opt/ats/scripts/sync-nginx-config.sh
#
#  After this, the X-ATS-Internal header strip is active in production.
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (sudo bash $0)" >&2
  exit 1
fi

STAGED_DIR="/opt/ats/scripts/nginx-staged"
SITES_AVAILABLE="/etc/nginx/sites-available"
SITES_ENABLED="/etc/nginx/sites-enabled"

if [[ ! -d "$STAGED_DIR" ]]; then
  echo "ERROR: $STAGED_DIR not found. Has the latest deploy landed?" >&2
  echo "       Check: ls -la /opt/ats/scripts/nginx-staged/" >&2
  exit 2
fi

echo "==> [1/3] copy staged configs -> $SITES_AVAILABLE"
for src in "$STAGED_DIR"/*.conf; do
  [[ -f "$src" ]] || continue
  base=$(basename "$src")
  dst="$SITES_AVAILABLE/$base"
  # Backup existing on first divergence so a manual rollback is trivial.
  if [[ -f "$dst" ]] && ! cmp -s "$src" "$dst"; then
    cp -a "$dst" "$dst.bak-$(date +%s)"
    echo "    backed up $base"
  fi
  install -m 0644 -o root -g root "$src" "$dst"
  # T99-T41 v3: ONLY symlink into sites-enabled if it already had a symlink
  # there. v2 auto-enabled every config and broke nginx -t because both site
  # files in this repo declare the same limit_req_zone — fine when only one
  # is enabled, fatal when both are. Operator decides what's enabled; we
  # only push the bytes.
  if [[ -L "$SITES_ENABLED/$base" ]]; then
    ln -sf "$dst" "$SITES_ENABLED/$base"
    echo "    installed + kept enabled: $base"
  else
    echo "    installed (NOT enabled — staged only): $base"
  fi
done

echo "==> [2/3] nginx -t"
nginx -t

echo "==> [3/3] systemctl reload nginx"
systemctl reload nginx

echo ""
echo "DONE. Verify the X-ATS-Internal strip with:"
echo "  curl -s -o /dev/null -w 'HTTP %{http_code}\\n' \\"
echo "    https://ats.rajasekarselvam.com/api/brokers/zerodha/auto-login/bundle \\"
echo "    -H 'x-ats-internal: 1'"
echo "Expected: HTTP 403 (external_ip rejection — header was stripped by nginx)"

#!/usr/bin/env bash
# Runs ON the VM (shipped via scp). Pure bash to avoid PS->SSH->bash quoting issues.
set +e

PASS=0
FAIL=0
ok() { echo "  [PASS] $1"; PASS=$((PASS+1)); }
ng() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
section() { echo; echo "----- $1 -----"; }

echo "=============================================================================="
echo "  VM-INTERNAL SYSTEMS CHECK (running on $(hostname))"
echo "=============================================================================="

# ---------- Container ----------
section "1. Backend container"

if sudo docker ps --filter "name=ats-backend" --filter "status=running" --format '{{.Names}}' | grep -q '^ats-backend$'; then
    ok "ats-backend container running"
else
    ng "ats-backend container NOT running"
fi

health_status=$(sudo docker inspect ats-backend --format '{{.State.Health.Status}}' 2>/dev/null)
[ "$health_status" = "healthy" ] && ok "container health=healthy" || ng "container health=$health_status"

image=$(sudo docker inspect ats-backend --format '{{.Config.Image}}' 2>/dev/null)
echo "$image" | grep -q 'ghcr.io.*ats-backend' && ok "image=$image" || ng "image=$image"

current_tag=$(cat /opt/ats/compose/.current-tag 2>/dev/null)
if echo "$current_tag" | grep -qE '^[a-f0-9]{6,}$'; then
    ok ".current-tag valid hex sha: $current_tag"
else
    ng ".current-tag: $current_tag"
fi

# ---------- Networking ----------
section "2. Networking"

if sudo ss -tlnp | grep -q ':8080.*docker-proxy'; then
    ok "127.0.0.1:8080 exposed by docker-proxy"
else
    ng "Port 8080 not bound by docker-proxy"
fi

if curl -sS --max-time 3 http://127.0.0.1:8080/api/health | grep -q '"ok":true'; then
    ok "loopback /api/health responds"
else
    ng "loopback /api/health failed"
fi

# ---------- nginx + TLS ----------
section "3. nginx + TLS"

if sudo systemctl is-active --quiet nginx; then
    ok "nginx systemd active"
else
    ng "nginx not active"
fi

[ -f /etc/nginx/sites-enabled/ats.rajasekarselvam.com.conf ] && ok "vhost present" || ng "vhost missing"

if sudo nginx -t 2>&1 | grep -q 'test is successful'; then
    ok "nginx config valid"
else
    ng "nginx config invalid"
fi

cert=/etc/letsencrypt/live/ats.rajasekarselvam.com/fullchain.pem
[ -f "$cert" ] && ok "TLS cert exists" || ng "TLS cert missing"

if sudo openssl x509 -in "$cert" -noout -checkend 2592000 >/dev/null 2>&1; then
    expiry=$(sudo openssl x509 -in "$cert" -noout -enddate | cut -d= -f2)
    ok "TLS cert valid > 30 days (expires $expiry)"
else
    ng "TLS cert expires within 30 days"
fi

if sudo systemctl list-timers --all 2>/dev/null | grep -qE 'certbot|snap\.certbot'; then
    ok "certbot auto-renew timer present"
else
    ng "certbot timer missing"
fi

# ---------- Audit log ----------
section "4. Audit log"

[ -f /var/log/ats/audit.log ] && ok "audit.log exists" || ng "audit.log missing"

audit_lines=$(wc -l </var/log/ats/audit.log 2>/dev/null)
[ "${audit_lines:-0}" -gt 0 ] && ok "audit.log has $audit_lines lines" || ng "audit.log is empty"

# Verify a recent event of the kinds we expect
if tail -50 /var/log/ats/audit.log 2>/dev/null | grep -q '"event":"order.blocked"'; then
    ok "audit captured order.blocked event"
else
    ng "no recent order.blocked event"
fi

if tail -50 /var/log/ats/audit.log 2>/dev/null | grep -q '"event":"ws.connect"'; then
    ok "audit captured ws.connect event"
else
    ng "no recent ws.connect event"
fi

if ls /var/log/ats/audit.log-* 2>/dev/null | grep -q 'audit.log-'; then
    rotated=$(ls /var/log/ats/audit.log-* | tail -1)
    ok "rotated log present: $(basename $rotated)"
else
    ng "no rotated audit log"
fi

# ---------- Required runtime files ----------
section "5. Required runtime files"

[ -f /etc/ats/backend.env ] && ok "/etc/ats/backend.env present" || ng "/etc/ats/backend.env missing"
[ -f /etc/ats/master.key ] && ok "/etc/ats/master.key present" || ng "/etc/ats/master.key missing"
[ -d /var/lib/ats/tokens ] && ok "/var/lib/ats/tokens directory present" || ng "/var/lib/ats/tokens missing"
[ -f /opt/ats/compose/docker-compose.yml ] && ok "/opt/ats/compose/docker-compose.yml present" || ng "compose file missing"
[ -f /opt/ats/scripts/deploy-on-vm.sh ] && ok "/opt/ats/scripts/deploy-on-vm.sh present" || ng "deploy script missing"
[ -d /var/www/ats.rajasekarselvam.com ] && ok "/var/www/ats.rajasekarselvam.com present" || ng "web root missing"
[ -f /var/www/ats.rajasekarselvam.com/app.html ] && ok "frontend app.html served" || ng "app.html missing"

# ---------- Logrotate + cron + rclone ----------
section "6. Audit archive pipeline"

[ -f /etc/logrotate.d/ats-audit ] && ok "logrotate config present" || ng "logrotate config missing"

if sudo logrotate --debug /etc/logrotate.d/ats-audit 2>&1 | grep -q 'Handling 1 logs'; then
    ok "logrotate config validates"
else
    ng "logrotate config validation failed"
fi

[ -f /etc/cron.d/ats-audit-rclone ] && ok "cron entry active (NOT .disabled)" || ng "cron entry missing"
[ ! -f /etc/cron.d/ats-audit-rclone.disabled ] && ok "no leftover .disabled file" || ng ".disabled cron file still present"

[ -f /usr/local/bin/ats-archive-audit.sh ] && [ -x /usr/local/bin/ats-archive-audit.sh ] && ok "archive wrapper script present + executable" || ng "wrapper script missing or non-exec"

if sudo rclone listremotes | grep -q '^ats-archive:$'; then
    ok "rclone remote 'ats-archive' configured"
else
    ng "rclone remote 'ats-archive' missing"
fi

if sudo rclone lsd ats-archive: 2>&1 | grep -qE '^[[:space:]]*-1[[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}'; then
    ok "rclone authenticates against Google Drive"
else
    ng "rclone GDrive auth broken"
fi

if sudo rclone lsd ats-archive: 2>&1 | grep -q 'ats-audit-archive'; then
    ok "GDrive folder 'ats-audit-archive' exists"
else
    ng "GDrive folder 'ats-audit-archive' missing"
fi

# ---------- Disk + memory ----------
section "7. Resources"

# T-461 (audit-2026-05-26 vm-scripts L3): df -BG is GNU-only; macOS dev
# test runs silently miscalculated. Use `df -Pk` (POSIX kilobytes) and
# divide by 1024*1024 in awk to get GB (rounded down to int).
usage_pct=$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
free_gb=$(df -Pk / | awk 'NR==2 {printf "%d", $4/1024/1024}')
[ "${usage_pct:-100}" -lt 50 ] && ok "Disk ${usage_pct}% used, ${free_gb}G free" || ng "Disk ${usage_pct}% used"

mem_usage=$(sudo docker stats --no-stream --format '{{.MemUsage}}' ats-backend 2>/dev/null)
echo "$mem_usage" | grep -qE 'MiB|GiB' && ok "Container memory: $mem_usage" || ng "Memory query failed: $mem_usage"

cpu_usage=$(sudo docker stats --no-stream --format '{{.CPUPerc}}' ats-backend 2>/dev/null)
echo "$cpu_usage" | grep -qE '[0-9]+\.[0-9]+%' && ok "Container CPU: $cpu_usage" || ng "CPU query failed: $cpu_usage"

# ---------- Sudoers and groups ----------
section "8. Auth + privileges"

sudo -l -U deployer 2>/dev/null | grep -q 'chown' && ok "deployer has chown sudoer rule" || ng "deployer sudoers rule missing"

groups deployer 2>/dev/null | grep -qw 'ats' && ok "deployer is in ats group" || ng "deployer not in ats group"

[ -f /etc/sudoers.d/ats-deployer ] && ok "/etc/sudoers.d/ats-deployer present" || ng "sudoers.d file missing"

# ---------- Summary ----------
echo
echo "=============================================================================="
echo "  VM-INTERNAL: $PASS passed, $FAIL failed"
echo "=============================================================================="

# Useful follow-up info for the user
echo
echo "Live state snapshot:"
sudo docker ps --filter name=ats-backend --format 'table {{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null
echo
sudo rclone ls ats-archive:ats-audit-archive/ 2>&1 | head -10
echo
echo "Audit log line counts (live + rotated):"
ls -lah /var/log/ats/ | grep audit

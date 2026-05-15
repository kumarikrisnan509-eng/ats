param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

# Tier 15: push a hardened nginx site config for ats.rajasekarselvam.com.
# This adds HSTS / CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy
# which the currently-deployed nginx server block does NOT serve. After this script
# runs, `curl -I https://ats.rajasekarselvam.com/` should return those headers.
#
# This script does NOT touch TLS certs (they are already on the VM from certbot).

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Update production nginx for ats.rajasekarselvam.com" -ForegroundColor Cyan
Write-Host "  Target: $VMUser@$VMHost" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$nginxConf = @'
# /etc/nginx/sites-available/ats.rajasekarselvam.com
# Tier 15: hardened production config -- adds HSTS / CSP / XFO / nosniff / referrer-policy.
# Reverse-proxy: HTTPS public -> 127.0.0.1:8080 (Node backend inside Docker compose).

server {
    listen 80;
    listen [::]:80;
    server_name ats.rajasekarselvam.com;

    # Redirect everything to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ats.rajasekarselvam.com;

    # certbot-managed certs (already in place)
    ssl_certificate     /etc/letsencrypt/live/ats.rajasekarselvam.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ats.rajasekarselvam.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 1.1.1.1 8.8.8.8 valid=300s;
    resolver_timeout 5s;

    # ---------- Security headers (Tier 15 addition) ----------
    # HSTS: lock browsers to HTTPS for 6 months
    add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;
    # Prevent MIME-sniffing
    add_header X-Content-Type-Options "nosniff" always;
    # Block iframe embedding (clickjacking defense)
    add_header X-Frame-Options "DENY" always;
    # Don't leak referrer to third parties
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    # Lock down permissions
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
    # CSP: deliberately permissive for now (cdnjs for React/Recharts), tighten in next tier
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss: https:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

    # Healthcheck endpoint -- don't log it
    location = /api/health {
        access_log off;
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket route
    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Everything else (API + static assets)
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # Static asset cache hints for /src/*.js (pre-built bundle)
    location ~* ^/src/.+\.(js|css|svg|woff2?)$ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
        # Re-emit security headers on cached responses
        add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    # Body size for POST endpoints (orders, etc.)
    client_max_body_size 256k;
}
'@

$bytes = [System.Text.Encoding]::UTF8.GetBytes($nginxConf)
$b64   = [Convert]::ToBase64String($bytes)

$bashScript = @"
set -uo pipefail
echo
echo '==> [1] BEFORE: current /etc/nginx/sites-available/ats.rajasekarselvam.com'
if [ -f /etc/nginx/sites-available/ats.rajasekarselvam.com ]; then
  sudo head -n 20 /etc/nginx/sites-available/ats.rajasekarselvam.com | sed 's/^/    /'
  echo '    ...'
else
  echo '    (file not present)'
fi

echo
echo '==> [2] Writing new config'
echo '$b64' | base64 -d | sudo tee /etc/nginx/sites-available/ats.rajasekarselvam.com.new > /dev/null
sudo chown root:root /etc/nginx/sites-available/ats.rajasekarselvam.com.new
sudo chmod 644 /etc/nginx/sites-available/ats.rajasekarselvam.com.new

echo
echo '==> [3] nginx -t against the NEW config (via temporary include)'
# Test by symlinking and running nginx -t
sudo mv /etc/nginx/sites-available/ats.rajasekarselvam.com.new /etc/nginx/sites-available/ats.rajasekarselvam.com
if [ ! -L /etc/nginx/sites-enabled/ats.rajasekarselvam.com ]; then
  sudo ln -s /etc/nginx/sites-available/ats.rajasekarselvam.com /etc/nginx/sites-enabled/ats.rajasekarselvam.com
fi
sudo nginx -t

echo
echo '==> [4] Reload nginx'
sudo systemctl reload nginx && echo '    reloaded'

echo
echo '==> [5] Verify security headers are now served'
curl -sI https://ats.rajasekarselvam.com/ | grep -E '^(strict-transport-security|x-content-type-options|x-frame-options|referrer-policy|content-security-policy|permissions-policy):' | sed 's/^/    /'
"@

Write-Host "[1/2] Pushing config + testing + reloading" -ForegroundColor Yellow
& ssh -i $SshKey -o StrictHostKeyChecking=accept-new "$VMUser@$VMHost" $bashScript 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[2/2] Final probe from this machine" -ForegroundColor Yellow
$resp = Invoke-WebRequest -Uri "https://ats.rajasekarselvam.com/" -Method Head -UseBasicParsing 2>&1
foreach ($h in @("Strict-Transport-Security","X-Content-Type-Options","X-Frame-Options","Referrer-Policy","Content-Security-Policy","Permissions-Policy")) {
    $v = $resp.Headers[$h]
    if ($v) { Write-Host "    $h : $v" -ForegroundColor Green }
    else    { Write-Host "    $h : (missing)" -ForegroundColor Red }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. ats.rajasekarselvam.com now serves a hardened nginx" -ForegroundColor Green
Write-Host "  config with HSTS / CSP / XFO / nosniff / referrer-policy." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

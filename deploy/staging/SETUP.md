# Staging environment setup (45 minutes)

**Goal:** `staging.ats.rajasekarselvam.com` on the same OCI VM as prod, mock broker, separate state volume. Lets you exercise deploys + breaking changes without touching live ticks.

**Status as of T-212 (2026-05-19):** the compose + nginx config exist and are now at security parity with prod (cap_drop, read_only, no-new-privileges, mem_limit, pids_limit, distinct master.key mount). DNS + TLS cert + CI integration are still operator-side. This doc walks through both.

## Step 0: Pre-flight (~5 min)

- Confirm you have SSH access to the VM as `deployer`.
- Confirm `dig ats.rajasekarselvam.com` resolves to `141.148.192.4`.
- Confirm you can log into the Hostinger DNS console.
- Generate a separate libsodium master key for staging on your local Windows machine:
  ```powershell
  node -e "const c=require('crypto'); console.log(c.randomBytes(32).toString('base64'))"
  ```
  Save the base64 string somewhere offline. You'll need it in Step 2.

## Step 1: DNS A record (Hostinger console, 5 min)

- Hostinger → Domains → rajasekarselvam.com → DNS / Nameservers
- Add A record:
  - **Name:** `staging.ats`
  - **Type:** A
  - **Value:** `141.148.192.4` (same as prod)
  - **TTL:** 3600
- Wait for propagation: `dig staging.ats.rajasekarselvam.com +short` should return the IP within ~5 min.

## Step 2: VM-side install (~20 min, run as `ubuntu` or `deployer`)

```bash
# 1. Directories
sudo mkdir -p /opt/ats/staging /opt/ats/staging-data /opt/ats/staging-logs
sudo mkdir -p /etc/ats-staging
sudo chown -R deployer:deployer /opt/ats/staging-data /opt/ats/staging-logs

# 2. Seed staging master.key (DISTINCT from prod's /etc/ats/master.key).
# Paste the base64 string you generated in Step 0:
echo "<base64-blob-from-step-0>" | base64 -d | sudo tee /etc/ats-staging/master.key > /dev/null
sudo chmod 400 /etc/ats-staging/master.key
sudo chown root:ats /etc/ats-staging/master.key

# 3. Seed staging backend.env (minimal — no real broker creds, no AI keys).
sudo tee /etc/ats-staging/backend.env > /dev/null <<'EOF'
SESSION_SECRET=staging-only-32-byte-string-not-prod  # T-195 refuses prod default, so this MUST be a real string
ATS_OPS_KEY=staging-ops-token-for-internal-routes
EOF
sudo chmod 640 /etc/ats-staging/backend.env
sudo chown root:ats /etc/ats-staging/backend.env

# 4. Copy the staging compose + nginx site config from your git checkout.
sudo cp /opt/ats/deploy/staging/docker-compose.staging.yml /opt/ats/staging/docker-compose.yml
sudo cp /opt/ats/deploy/staging/nginx.conf /etc/nginx/sites-available/staging.ats.rajasekarselvam.com.conf

# 5. Create staging .env (image + repo owner pinning).
sudo tee /opt/ats/staging/.env > /dev/null <<'EOF'
ATS_REPO_OWNER=kumarikrisnan509-eng
ATS_IMAGE_TAG=latest
ATS_PORT_HOST=8081
BROKER=mock
ENV_NAME=staging
KILL_SWITCH=true
LIVE_TRADING=false
EOF

# 6. Pull image + start.
echo "$GHCR_PAT" | sudo docker login ghcr.io -u kumarikrisnan509-eng --password-stdin
cd /opt/ats/staging
sudo docker compose --env-file .env up -d

# 7. Verify staging container responds locally.
curl -sS http://127.0.0.1:8081/api/health
# Expect HTTP 200 with `ok:true`, `env:"staging"`, `killSwitch:true`.

# 8. Enable nginx site.
sudo ln -s /etc/nginx/sites-available/staging.ats.rajasekarselvam.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 9. TLS cert (Let's Encrypt).
sudo certbot --nginx -d staging.ats.rajasekarselvam.com

# 10. Verify staging via public URL.
curl -sS https://staging.ats.rajasekarselvam.com/api/health
```

## Step 3: T-212 hardening verification (~5 min)

Confirm the new prod-parity hardening is actually in effect:

```bash
# Container should have NO capabilities except NET_BIND_SERVICE.
sudo docker inspect ats-backend-staging --format '{{.HostConfig.CapDrop}}'
# Expect: [ALL]
sudo docker inspect ats-backend-staging --format '{{.HostConfig.CapAdd}}'
# Expect: [NET_BIND_SERVICE]

# Container should be read-only with tmpfs /tmp.
sudo docker inspect ats-backend-staging --format '{{.HostConfig.ReadonlyRootfs}}'
# Expect: true
sudo docker inspect ats-backend-staging --format '{{.HostConfig.Tmpfs}}'
# Expect: map[/tmp:size=32m]

# Memory + PIDs caps in effect.
sudo docker inspect ats-backend-staging --format '{{.HostConfig.Memory}}'
# Expect: 402653184  (384m)
sudo docker inspect ats-backend-staging --format '{{.HostConfig.PidsLimit}}'
# Expect: 192

# Master key mount points at the STAGING key, not prod.
sudo docker inspect ats-backend-staging \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}' \
  | grep master.key
# Expect: /etc/ats-staging/master.key -> /run/secrets/master.key
```

## Step 4: CI integration (~15 min — operator-side, not yet automated)

The audit's M3.3 ask is a deploy gate where every push to a `staging` branch builds + deploys to staging FIRST, then promotes to prod only on success. To wire this up:

1. Add a `staging` branch protection rule in GitHub: allow pushes only from CI.
2. Extend `.github/workflows/deploy.yml`:
   - Add a `deploy-staging` job triggered on `push: branches: [staging]`.
   - Job SSHs into the VM, sets `cd /opt/ats/staging`, runs the same atomic-compose-up + health-check loop the prod deploy uses.
   - Runs the Playwright suite against `https://staging.ats.rajasekarselvam.com` (replace BASE_URL).
   - Marks a `staging-ok` deployment in GitHub on success.
3. Optional: add a `workflow_dispatch` job `promote-staging-to-prod` that re-tags the staging-tested image as the prod target and re-runs the prod deploy.
4. Add staging-only secrets to GitHub Actions: `STAGING_SSH_KEY`, `STAGING_GHCR_TOKEN`.

T-212 deliberately did NOT ship the CI workflow because:
- Until DNS + the staging container are actually up, the workflow would fail every push to a `staging` branch (which doesn't exist yet).
- Wiring this without the operator's GHCR pull token for staging would block the deploy on a secret-not-found error.

When you're ready, follow Step 4 manually. A draft `deploy-staging` job stanza is below for reference:

```yaml
  deploy-staging:
    needs: build-and-push
    if: github.ref == 'refs/heads/staging'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: SSH deploy
        # ... same shape as the prod deploy job but targets /opt/ats/staging
        # and uses STAGING_SSH_KEY + STAGING_GHCR_TOKEN secrets.
```

## Step 5: Tear-down (if needed)

```bash
cd /opt/ats/staging && sudo docker compose down
sudo rm -rf /opt/ats/staging /opt/ats/staging-data /opt/ats/staging-logs
sudo rm -rf /etc/ats-staging
sudo rm /etc/nginx/sites-enabled/staging.ats.rajasekarselvam.com.conf
sudo systemctl reload nginx
sudo certbot delete --cert-name staging.ats.rajasekarselvam.com
```

## What's different from prod (deliberate)

| Aspect | Prod | Staging | Why |
|---|---|---|---|
| Image | versioned SHA | `latest` (or staging branch SHA) | Staging tests unreleased changes |
| BROKER | zerodha | mock | No live ticks |
| KILL_SWITCH | env-controlled, default false in prod runs | hard true | Defense-in-depth — no orders ever route to broker |
| LIVE_TRADING | env-controlled | hard false | Second gate |
| Master key | `/etc/ats/master.key` | `/etc/ats-staging/master.key` | Distinct; staging sealed cells unreadable from prod state and vice versa |
| State volume | `/opt/ats/tokens` | `/opt/ats/staging-data` | Distinct |
| Logs | `/var/log/ats` | `/opt/ats/staging-logs` | No rotation/archive collision |
| `mem_limit` | 512m | 384m | Single-tenant + no broker connection |
| `pids_limit` | 256 | 192 | Same rationale |

## Why this exists

CODE-AUDIT §E.9 / F.5 M3.3 flagged that the staging environment was aspirational, not active — files existed but the compose lacked the security hardening prod had, so a `read_only`-incompatible code change could ship to prod even if "tested in staging" because staging would silently let it work. T-212 closes that parity gap.

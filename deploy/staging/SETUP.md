# Staging environment setup (30 minutes)

Goal: `staging.ats.rajasekarselvam.com` on the same OCI VM as prod, mock broker,
separate state volume. Lets you exercise deploys without touching live ticks.

## Step 1: DNS A record (Hostinger console, 5 min)

- Log in to Hostinger
- Domains -> rajasekarselvam.com -> DNS / Nameservers
- Add A record:
  - Name: `staging.ats`
  - Type: A
  - Value: `141.148.192.4` (same as prod)
  - TTL: 3600

Wait for propagation (`dig staging.ats.rajasekarselvam.com` returns the IP).

## Step 2: VM-side install (15 min, run as ubuntu)

```bash
# Pull the staging compose + nginx config
sudo mkdir -p /opt/ats/staging /opt/ats/staging-data /var/log/ats-staging
sudo chown -R ubuntu:ubuntu /opt/ats/staging-data /var/log/ats-staging

# Copy from your git checkout (or scp from your laptop)
sudo cp /opt/ats/deploy/staging/docker-compose.staging.yml /opt/ats/staging/docker-compose.yml
sudo cp /opt/ats/deploy/staging/nginx.conf /etc/nginx/sites-available/staging.ats.rajasekarselvam.com.conf

# Create staging .env
sudo tee /opt/ats/staging/.env > /dev/null <<'EOF'
ATS_REPO_OWNER=kumarikrisnan509-eng
ATS_IMAGE_TAG=latest
ATS_PORT_HOST=8081
BROKER=mock
ENV_NAME=staging
KILL_SWITCH=true
EOF

# Pull image + start
echo "$GHCR_PAT" | sudo docker login ghcr.io -u kumarikrisnan509-eng --password-stdin
cd /opt/ats/staging
sudo docker compose --env-file .env up -d

# Verify staging container responds
curl -s http://127.0.0.1:8081/api/health

# Enable nginx site
sudo ln -s /etc/nginx/sites-available/staging.ats.rajasekarselvam.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS cert
sudo certbot --nginx -d staging.ats.rajasekarselvam.com

# Verify
curl -s https://staging.ats.rajasekarselvam.com/api/health
```

## Step 3: Use it

Now point any test deploy at staging first:

```bash
# In your deploy-tier*.ps1, change the SSH target to a staging-only path:
#   /opt/ats/staging/.env  (staging)
#   vs /opt/ats/compose/.env  (prod)
```

OR adopt a "deploy to staging first, smoke-test, then prod" workflow by adding
a `target` input to the GH Actions deploy workflow that switches the SSH path.

## Step 4: Tear-down (if needed)

```bash
cd /opt/ats/staging && sudo docker compose down
sudo rm -rf /opt/ats/staging /opt/ats/staging-data /var/log/ats-staging
sudo rm /etc/nginx/sites-enabled/staging.ats.rajasekarselvam.com.conf
sudo systemctl reload nginx
```

# GitHub auto-deploy setup — rajasekarselvam.com

End-to-end checklist to get GitHub Actions pushing your code to the Oracle Cloud Linux VM
on every `git push` to `main`. Pipeline:

```
git push main
   │
   ▼
GitHub Actions
   ├── ci.yml validates code (node --check, JSX parse, secret-leak guard)
   ├── deploy.yml builds Docker image (linux/amd64)
   ├── pushes to ghcr.io/<owner>/ats-backend:<sha>  + :latest
   ├── SSHes to OCI VM as `deployer`
   └── runs /opt/ats/scripts/deploy-on-vm.sh
                                 │
                                 ▼
                       VM pulls image, restarts container,
                       extracts static files to /var/www,
                       reloads Nginx, health-checks, rolls back on failure.
```

---

## 0. One-time: create the GitHub repo

1. On GitHub, create a **private** repo, e.g. `your-handle/ats`.
2. Locally:
   ```bash
   cd "C:\Users\localuserwin11\Documents\Claude\Projects\ATS\ATS Design"
   git init
   git add .
   git commit -m "Initial commit — ATS prototype + deploy"
   git branch -M main
   git remote add origin git@github.com:your-handle/ats.git
   git push -u origin main
   ```
3. Verify `.gitignore` did its job:
   ```bash
   git ls-files | grep -E 'master.key|\.enc$|backend.env$|node_modules|audit.log' && echo "LEAK" || echo "clean"
   ```
   Must print `clean`.

---

## 1. Bootstrap the VM

```bash
# From your laptop, inside the project root
rsync -az deploy/ opc@<OCI-IP>:/tmp/ats-deploy/
ssh opc@<OCI-IP>
sudo bash /tmp/ats-deploy/scripts/setup-oracle-linux-docker.sh
```

What that does:
- Installs Docker Engine + compose plugin
- Creates the `deployer` user (in `docker` group, narrow sudoers for `nginx reload` + atomic static swap)
- Drops `/opt/ats/compose/docker-compose.yml` and `/opt/ats/scripts/deploy-on-vm.sh` in place
- Generates `/etc/ats/master.key` (440, root:ats) and seeds `/etc/ats/backend.env`
- Installs `/etc/nginx/conf.d/rajasekarselvam.com.conf` + a self-signed placeholder cert
- Opens firewall ports 80/443

After it finishes, **issue real TLS**:
```bash
sudo certbot --nginx -d rajasekarselvam.com -d www.rajasekarselvam.com
```

---

## 2. Create the GitHub-Actions SSH key

On your laptop:

```bash
mkdir -p ~/.ssh-ats
ssh-keygen -t ed25519 -N "" -f ~/.ssh-ats/ats-deploy -C "github-actions@rajasekarselvam.com"
cat ~/.ssh-ats/ats-deploy.pub
cat ~/.ssh-ats/ats-deploy        # << this goes into the GH Secret in step 4
```

Authorize the public key on the VM:

```bash
ssh opc@<OCI-IP>
sudo -u deployer mkdir -p /home/deployer/.ssh
sudo -u deployer chmod 700 /home/deployer/.ssh
echo '<paste ats-deploy.pub contents>' | sudo -u deployer tee -a /home/deployer/.ssh/authorized_keys
sudo -u deployer chmod 600 /home/deployer/.ssh/authorized_keys
```

Verify from your laptop:
```bash
ssh -i ~/.ssh-ats/ats-deploy deployer@<OCI-IP> "docker --version && whoami"
# Expect: docker version + 'deployer'
```

Grab the host key for the known_hosts secret:
```bash
ssh-keyscan -H rajasekarselvam.com
# OR by IP: ssh-keyscan -H <OCI-IP>
# Copy the full output — multiple lines.
```

---

## 3. Create the GHCR pull token

GitHub Actions can push to GHCR using `GITHUB_TOKEN` automatically, but the **VM needs its
own credential to pull**. Create a fine-grained Personal Access Token:

1. <https://github.com/settings/tokens?type=beta> → Generate new token → Fine-grained.
2. **Resource owner:** you. **Repository access:** Only the `ats` repo.
3. **Permissions:** Package permissions → `read:packages`. Nothing else.
4. Expiry: 90 days (set a calendar reminder to rotate).
5. Copy the token starting with `github_pat_...`. This goes into `GHCR_PULL_TOKEN`.

---

## 4. Add GitHub Secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**.

Add these exactly:

| Secret name           | Value                                                           |
|-----------------------|-----------------------------------------------------------------|
| `OCI_SSH_HOST`        | `rajasekarselvam.com` (or the raw IP)                           |
| `OCI_SSH_USER`        | `deployer`                                                      |
| `OCI_SSH_PRIVATE_KEY` | Full contents of `~/.ssh-ats/ats-deploy` (including BEGIN/END)  |
| `OCI_SSH_KNOWN_HOSTS` | Full output of `ssh-keyscan -H rajasekarselvam.com`             |
| `GHCR_PULL_TOKEN`     | The fine-grained PAT from step 3                                |

DO NOT add `ZERODHA_API_KEY` / `ZERODHA_API_SECRET` to GitHub. Those live in
`/etc/ats/backend.env` on the VM. Keep them off CI.

---

## 5. Create the GitHub "production" environment (recommended)

This gives you a fail-safe even though you chose auto-deploy.

1. Repo → **Settings → Environments → New environment** → name `production`.
2. Add a **deployment branch rule**: only `main`.
3. (Optional but recommended) Add a **required reviewer** = your GitHub user. With this
   on, the deploy job will pause until you click Approve in the Actions tab. You can
   remove it later when you have full confidence.

---

## 6. First deploy

```bash
git push origin main
```

Then watch:
- <https://github.com/your-handle/ats/actions> — pipeline runs
- The `validate` job parses every JS and JSX file and scans for committed secrets
- The `build-and-push` job tags the image as `ghcr.io/your-handle/ats-backend:<short-sha>` and `:latest`
- The `deploy` job SSHs to the VM and runs `deploy-on-vm.sh`
- Final step curls `https://rajasekarselvam.com/api/health` and fails the workflow if it doesn't return 200

If anything fails, the VM script automatically reverts to the previous image tag and static directory.

---

## 7. Rollback a bad deploy after the fact

Three ways, from easiest to most surgical:

```bash
# A) On the VM — point back at a previous image tag
ssh deployer@<OCI-IP>
cd /opt/ats/compose
docker images ghcr.io/<owner>/ats-backend  # list available tags
ATS_IMAGE_TAG=<previous-sha> ATS_REPO_OWNER=<owner> docker compose up -d
echo <previous-sha> > .current-tag

# B) From GitHub — re-run an earlier successful workflow
# Actions tab → pick a green run → "Re-run all jobs"

# C) git revert + push
git revert HEAD
git push origin main
```

---

## 8. Daily operations cheatsheet

```bash
# View backend logs
ssh deployer@<OCI-IP> "docker logs -f ats-backend"

# Flip kill switch
ssh deployer@<OCI-IP>
sudo sed -i 's/^KILL_SWITCH=.*/KILL_SWITCH=false/' /etc/ats/backend.env
docker compose -f /opt/ats/compose/docker-compose.yml --project-directory /opt/ats/compose restart

# Health
curl https://rajasekarselvam.com/api/health | jq

# Switch from mock to real Zerodha (after entering Kite Connect keys in backend.env)
ssh deployer@<OCI-IP>
sudo sed -i 's/^BROKER=.*/BROKER=zerodha/' /etc/ats/backend.env
docker compose -f /opt/ats/compose/docker-compose.yml --project-directory /opt/ats/compose restart
# Then visit https://rajasekarselvam.com/api/brokers/zerodha/login to OAuth
```

---

## 9. Security checklist (do this before going public)

- [ ] Repo is **private** on GitHub.
- [ ] `.gitignore` excludes `master.key`, `tokens/`, `.env`, `audit.log`. Verified with `git ls-files`.
- [ ] GitHub Secrets are set on the **repo** (not at org level) so they cannot leak to other repos.
- [ ] `production` environment has at least branch protection (`main` only); reviewer optional.
- [ ] Branch protection on `main`: require status checks (`validate`), no force-push, no deletion.
- [ ] OCI Security List blocks port 8080 from the public Internet.
- [ ] SSH on the VM is restricted to your IP only (port 22).
- [ ] `deployer` user has no shell sudo beyond the narrow allow-list in `/etc/sudoers.d/ats-deployer`.
- [ ] `GHCR_PULL_TOKEN` has only `read:packages` scope.
- [ ] Set a 90-day rotation reminder for `GHCR_PULL_TOKEN` and `OCI_SSH_PRIVATE_KEY`.

---

## 10. Troubleshooting

| Symptom                                       | Cause / fix                                                   |
|-----------------------------------------------|---------------------------------------------------------------|
| Action fails at `docker login`                | `GHCR_PULL_TOKEN` missing / wrong / lacks `read:packages`     |
| Action fails at SSH step "host key mismatch"  | VM IP changed. Re-run `ssh-keyscan` and update `OCI_SSH_KNOWN_HOSTS` |
| `deploy-on-vm.sh` says "permission denied" on `/var/www` swap | `setup-oracle-linux-docker.sh` wasn't re-run after edits; or `/etc/sudoers.d/ats-deployer` is missing |
| Container starts but `/api/health` 500s       | Likely `MASTER_KEY` not mounted; check `/etc/ats/master.key` exists and is `440 root:ats` |
| Build OK, deploy step says "image pull denied" | VM is using a stale or wrong PAT — rotate `GHCR_PULL_TOKEN`   |
| HEALTHCHECK reports "unhealthy"               | `BROKER=zerodha` + no OAuth done yet → expected before first connect. Once you do `/api/brokers/zerodha/login`, it goes healthy. |

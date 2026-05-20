# ATS — Automated Trading System (rajasekarselvam.com)

AI-assisted Indian-markets trading & investing cockpit.
SEBI-aware, BYOK broker model, Zerodha-first, broker-portable architecture.

> **Status:** prototype + deploy scaffolding. Realtime market data via Kite Connect is supported.
> **No real order placement is wired in this repo.** Order execution must be enabled by the
> repository owner deliberately, after Paper-adapter contract tests pass.

## Repo layout

```
ATS Design/
├── app.html, styles.css           # Cockpit shell (loaded into the browser)
├── src/                           # 52 JSX files — screens, primitives, AI assistant
├── .github/workflows/
│   ├── ci.yml                     # PR + push validation (lint, syntax, secret-leak guard)
│   └── deploy.yml                 # Build Docker image, push to GHCR, deploy to OCI VM
├── .dockerignore
├── .gitignore
└── deploy/
    ├── ANALYSIS-v2.md             # Deep analysis + realtime architecture
    ├── README-DEPLOY-v2.md        # End-to-end manual deploy walkthrough
    ├── GITHUB-SETUP.md            # Step-by-step for the auto-deploy pipeline
    ├── docker/
    │   ├── Dockerfile             # Multi-stage; node:20-alpine; non-root; HEALTHCHECK
    │   └── docker-compose.yml     # Runs on the VM; loads /etc/ats/backend.env
    ├── nginx/
    │   └── rajasekarselvam.com.conf
    ├── systemd/
    │   └── ats-backend.service    # Used by the non-Docker variant
    ├── scripts/
    │   ├── setup-oracle-linux-docker.sh   # One-shot VM bootstrap for Docker flow
    │   ├── setup-oracle-linux.sh          # Older non-Docker variant
    │   ├── deploy-on-vm.sh                # GitHub Actions calls this over SSH
    │   └── deploy.sh                      # Manual rsync fallback (non-Docker)
    └── backend/
        ├── package.json
        ├── server.js              # Express + ws; broker-pluggable
        ├── brokers/
        │   ├── gateway.js         # BrokerGateway interface (no placeOrder by design)
        │   ├── mock-broker.js     # Default — simulated ticks
        │   ├── zerodha-broker.js  # Kite Connect realtime via KiteTicker
        │   └── index.js
        ├── crypto-vault.js        # libsodium secretbox token encryption
        └── sessions.js
```

## Local development

```bash
cd "ATS Design"
# Frontend only — open app.html in a browser (Babel compiles JSX at runtime).
# The cockpit will use its built-in tick simulator.

# Backend (optional, for end-to-end testing):
cd deploy/backend
cp .env.example .env
npm install
node server.js
# Open http://127.0.0.1:8080/api/health
```

When the cockpit is served from the same origin as the backend (via Nginx), the patched
`src/live-ticks.jsx` will detect `/ws` and switch from simulator to real-feed automatically.

## Deploying

Two paths. Pick the one you want.

### A) Docker via GitHub Actions (this repo's default)

1. Bootstrap the VM once:
   ```bash
   ssh opc@<VM-IP>
   sudo bash /tmp/ats-deploy/scripts/setup-oracle-linux-docker.sh
   ```
2. Add GitHub Secrets (`OCI_SSH_HOST`, `OCI_SSH_USER`, `OCI_SSH_PRIVATE_KEY`, `OCI_SSH_KNOWN_HOSTS`, `GHCR_PULL_TOKEN`) — see `deploy/GITHUB-SETUP.md`.
3. `git push origin main`. The `deploy.yml` workflow builds, pushes to GHCR, SSHs to the VM, and runs `deploy-on-vm.sh`.

### B) Manual rsync (no Docker)

See `deploy/README-DEPLOY-v2.md`. Useful if you can't put Docker on the VM yet.

## Live-trading safety

Hard policies, enforced in this repo:

1. **No real order execution.** `BrokerGateway` does not have `placeOrder`. The only order
   route in the backend is `/api/orders/dry-run`, which writes to the append-only audit log
   and never calls a broker.
2. **Kill switch defaults `true`.** Required to be flipped to `false` per-deploy, on the VM.
3. **Tokens encrypted at rest** with libsodium secretbox. Master key in `/etc/ats/master.key`
   (root-readable only). Migrate to OCI Vault for production scale.
4. **BYOK only.** Each user provides their own Zerodha credentials via OAuth.
5. **Static IP whitelisting** required by SEBI for the post-1-Apr-2026 algo framework.
   Reserve an OCI public IP and declare it to Zerodha before going live.

Wiring real order execution must be:
- A separate PR with documented intent
- Behind a new env flag `LIVE_ORDERS_ENABLED=true` (default false)
- With a confirmation modal on every order
- With Paper-adapter contract tests green
- With the kill switch tested first

## License

UNLICENSED — private. See `LICENSE` once added.

## Author

Rajasekar Selvam (<rajasekarjavaee@gmail.com>) — built with Claude.

<!-- T-248f re-trigger: app.html hotfix deploy bump -->

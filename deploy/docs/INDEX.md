# ATS — Documentation Index

Single entry point for every doc in this repo. Live at
[github.com/.../deploy/docs/INDEX.md](https://github.com/kumarikrisnan509-eng/ats/blob/main/deploy/docs/INDEX.md).

**Audience tags:** 👤 user, 🛠 operator, 🧑‍💻 contributor.

## When something is broken — start here

| Doc | What it's for |
|---|---|
| 🛠 [INCIDENT-RUNBOOK](INCIDENT-RUNBOOK.md) | 8 failure modes, quick diagnostic table, self-healing system summary, escalation tiers. Open this first during any outage. |
| 🛠 [DR-RUNBOOK](../DR-RUNBOOK.md) | Disaster-recovery procedure if the VM is unrecoverable. Restore from the latest GDrive backup. |

## Operating the live system

| Doc | What it's for |
|---|---|
| 🛠 [README-DEPLOY-v2](../README-DEPLOY-v2.md) | Production deploy guide. GitHub Actions → GHCR → Oracle VM via SSH. |
| 🛠 [AUTO-LOGIN-SETUP](../../AUTO-LOGIN-SETUP.md) | Single-account Zerodha auto-login (the `zerodha-auto-login.js` host script). For the operator's own Kite account. |
| 🛠 [TIER76-BULKROTATE](TIER76-BULKROTATE.md) | Per-user daily TOTP rotation. Architecture diagram + the two internal routes (`bulk-rotate`, `seal-token`) shipped in T-133. |
| 🛠 [scripts/systemd/INSTALL](../scripts/systemd/INSTALL.md) | 5-minute install of the bulk-rotate systemd timer on the VM host. Operator picks this up to ship Tier 76 Phase 2. |
| 🛠 [GITHUB-SETUP](../GITHUB-SETUP.md) | One-time CI/CD configuration: GHCR registry, repo secrets, deployer SSH key. |
| 🛠 [SECRETS](../../SECRETS.md) | Where each secret lives (master.key, broker_accounts, audit.log, sealed-tokens). Rotation procedures. |
| 🛠 [staging/SETUP](../staging/SETUP.md) | Spin up a staging clone of the VM for safe pre-prod testing. |
| 🛠 [monitoring/README](../monitoring/README.md) | Optional Prometheus/Grafana scrape config for `/api/admin/observability` and `/api/health-deep`. |
| 🛠 [RCLONE-CONFIG-GUIDE](../../RCLONE-CONFIG-GUIDE.md) | Configure rclone for the nightly GDrive backup target. |
| 🛠 [AUTOMATION-PROBE](../AUTOMATION-PROBE.md) | End-to-end probe that validates the full automation chain (broker → scanner → signal → paper fill). |

## Understanding the build

| Doc | What it's for |
|---|---|
| 🧑‍💻 [README](../../README.md) | Top-level overview: what ATS is, the stack, how to run it locally. |
| 🧑‍💻 [ANALYSIS-v2](../ANALYSIS-v2.md) | Deeper architectural decisions: per-user multi-tenant model, libsodium SealedBox vault, OAuth flow. |
| 🧑‍💻 [test-e2e/README](../../test-e2e/README.md) | Playwright spec inventory (smoke, happy-path, health-deep, etc.) + how to add new specs. |
| 🧑‍💻 [TIER75-78-DEFERRED](../../TIER75-78-DEFERRED.md) | What was left after Tiers 71-74 and the rationale for each deferral. |

## For the end user (you, on the app)

| Doc | What it's for |
|---|---|
| 👤 In-app `#status` page | Live deploy SHA, broker connection, last reauth, market regime. The first place to look if something feels stuck. |
| 👤 In-app `#brokers` screen | Add/remove your Kite account, enable daily auto-reauth, see when the last rotation succeeded. |
| 👤 In-app `#settings` → Telegram | Wire up 2FA alerts so the confirm-before-trade challenge can reach you. Required for `promote to live`. |
| 👤 In-app `#audit` screen | Append-only signed log of every order, signal, risk check. Filter by mode, strategy, status. |

## Conventions

- **`T-NNN`** in commit subjects = ticket from the v11 master plan or its
  successors. T-1..T-77 are the original tier rollout; T-78 onward is the
  honest-data + self-healing + multi-tenant sweep.
- **`Tier N`** in commit subjects = a higher-level deferred chunk. See
  TIER75-78-DEFERRED.md for the canonical list.
- **`__mock_`** prefix on JS arrays = demo data gated behind
  `MockData.isDemoOn()`. Never rendered in production after T-136/T-137/T-139.
- **Honest-data banner pattern** = a yellow `<div role="note">` above any
  section that's still demo. Banners explicitly tell the user what's live
  and what isn't. See T-82 / T-86 / T-91 / T-95 for examples.

## Where to add new docs

- **Operational runbook for a recurring task** → `deploy/docs/` with
  filename `<ACTION>-RUNBOOK.md` or `<TIER>-<NAME>.md`.
- **End-user how-to** → top-level `*.md` until we stand up a proper docs
  site (v11 I3 long-term).
- **Architectural decision** → top-level `ANALYSIS-vN.md` if it represents
  a major shift; otherwise add a short note to the existing v2 file.

Then update this INDEX. CI doesn't enforce that yet — please don't forget.

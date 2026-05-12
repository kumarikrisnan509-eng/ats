# Deploy `rajasekarselvam.com` — v2 with realtime broker data

End-to-end walkthrough for the latest ATS Design with Zerodha Kite Connect live ticks.

Assumes you have:

- An Oracle Cloud (OCI) compute instance running **Oracle Linux 9** (ARM Ampere is fine)
- The domain `rajasekarselvam.com` with DNS you control
- A **Zerodha Kite Connect** subscription (₹2000/mo) and a Kite Connect "App" registered at <https://developers.kite.trade/>
  - Note your `api_key` and `api_secret`
  - Redirect URL must be `https://rajasekarselvam.com/api/brokers/zerodha/callback`
- Your laptop has SSH access to the VM and `rsync` installed

End state:
- `https://rajasekarselvam.com/` serves the cockpit
- The top ticker, `<LiveCell/>`s, and dashboards show **real Zerodha LTPs** during market hours
- The kill switch (KILL_SWITCH=true) blocks the only order path; no real orders are placed by this scaffold

---

## Step 1 — Bootstrap the VM (idempotent)

```bash
# From your laptop, inside ATS Design/
rsync -az deploy/ opc@<OCI-IP>:/tmp/ats-deploy/
ssh opc@<OCI-IP>
sudo bash /tmp/ats-deploy/scripts/setup-oracle-linux.sh
```

What's new in v2 setup vs v1:
- Creates `/var/lib/ats/tokens` (mode 700, owner `ats`) — sealed access-token store
- Generates `/etc/ats/master.key` if absent (32 random bytes, mode 440, root:ats) — libsodium master key
- Same Nginx, systemd, certbot path

---

## Step 2 — Deploy app + backend

```bash
bash deploy/scripts/deploy.sh opc@<OCI-IP>
```

This syncs `app.html`, `styles.css`, `src/` to `/var/www/rajasekarselvam.com/` and the v2 backend (with `brokers/`, `crypto-vault.js`, `sessions.js`) to `/opt/ats/backend/`, then `npm install` and `systemctl restart ats-backend`.

The new `package.json` pulls `kiteconnect` and `libsodium-wrappers`. Native module builds happen on the server — Oracle Linux 9 has `make` + `gcc` from `setup-oracle-linux.sh` (installed via `policycoreutils-python-utils` deps). If you hit build errors, run `sudo dnf groupinstall -y "Development Tools"` once.

---

## Step 3 — Issue TLS

```bash
ssh opc@<OCI-IP>
sudo certbot --nginx -d rajasekarselvam.com -d www.rajasekarselvam.com \
    --agree-tos -m you@rajasekarselvam.com --redirect --no-eff-email
```

---

## Step 4 — Verify mock mode

By default `BROKER=mock`. Visit `https://rajasekarselvam.com/` — you see the cockpit with the simulator feeding ticks. Verify backend health:

```bash
curl https://rajasekarselvam.com/api/health | jq
# {
#   "ok": true,
#   "broker": { "name": "mock", "connected": true, "subscribers": N }
# }
```

Open the dashboard. The `LiveTicker` strip says **LIVE** and prices update every ~800 ms (the simulator is now ticking from the backend, fanned out via `/ws`).

---

## Step 5 — Switch to Zerodha

Edit `/etc/ats/backend.env`:

```bash
sudo nano /etc/ats/backend.env
```

Set:

```
BROKER=zerodha
ZERODHA_API_KEY=<your api key>
ZERODHA_API_SECRET=<your api secret>
ZERODHA_REDIRECT_URL=https://rajasekarselvam.com/api/brokers/zerodha/callback
```

Restart:

```bash
sudo systemctl restart ats-backend
sudo journalctl -u ats-backend -n 50
curl https://rajasekarselvam.com/api/health
# expect: broker.name == "zerodha", broker.connected == false, subscribedInstruments == 0
```

Notice `connected: false`: the adapter is alive but has no access token yet. Authenticate:

1. Open <https://rajasekarselvam.com/api/brokers/zerodha/login> in the browser. You're redirected to Kite, you log in with your Zerodha credentials + TOTP.
2. Kite redirects back to `/api/brokers/zerodha/callback?request_token=...`.
3. The backend exchanges the request_token for an access_token, seals it with the master key, writes `/var/lib/ats/tokens/<userId>.enc`, and redirects you to `/?connected=zerodha`.
4. The Kite Ticker connects. `/api/health` now shows `connected: true`.

---

## Step 6 — Subscribe to instruments

Today the backend subscribes to `DEFAULT_SYMBOLS` from `/etc/ats/backend.env`. With `BROKER=zerodha`, those names need to be **instrument tokens** because Kite Ticker subscribes by token, not by symbol. There are two ways:

**a) Quick test (one symbol, manually):**
- Find the instrument token for, say, INFY on NSE: <https://api.kite.trade/instruments> (CSV dump). For INFY it's typically `408065`.
- Set `DEFAULT_SYMBOLS=TOKEN:408065`. Restart. The dashboard now flashes the INFY LTP.

**b) Proper setup (planned, plan doc §3):**
- Implement the instruments-master sync: download `/instruments` CSV at 6:15 AM IST daily, store in Postgres, and build `symbolForToken(token)` + `tokenForSymbol(sym)` lookups.
- Wire that into `ZerodhaBroker` via the `symbolForToken` constructor arg.
- Then `DEFAULT_SYMBOLS=INFY,TCS,HDFCBANK,...` works naturally.

This scaffold leaves the instrument master as the next concrete task.

---

## Step 7 — Daily access-token expiry

Kite access tokens expire ~6 AM IST. Tomorrow morning your `LiveTicker` will go red. Two options:

1. **Manual:** repeat Step 5's OAuth click (5 seconds).
2. **Automated:** add a cron job at 8 AM IST that runs `curl -s -L -c /tmp/c -b /tmp/c "https://rajasekarselvam.com/api/brokers/zerodha/login"` — but that won't work because Kite requires interactive TOTP. Practically, you do it manually each morning, or wire an SMS/Telegram nudge.

Long-term, you can use Kite's **API for offline session** (only available to vendor-empanelled apps under the SEBI framework). Not part of v2.

---

## Operations cheatsheet

```bash
sudo systemctl status ats-backend
sudo journalctl -u ats-backend -f

# Flip kill switch
sudo sed -i 's/^KILL_SWITCH=.*/KILL_SWITCH=false/' /etc/ats/backend.env
sudo systemctl restart ats-backend

# Switch back to mock for a demo
sudo sed -i 's/^BROKER=.*/BROKER=mock/' /etc/ats/backend.env
sudo systemctl restart ats-backend

# Forget a user's Zerodha session
sudo rm /var/lib/ats/tokens/<userId>.enc

# Audit log
sudo tail -f /var/log/ats/audit.log
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm install` fails compiling `libsodium` | missing build toolchain | `sudo dnf groupinstall -y "Development Tools"` |
| `/api/health` shows broker.connected=false even after OAuth | wrong instrument tokens, or market closed | Verify with `getQuote` on REST; remember NSE is closed weekends + holidays |
| Kite OAuth redirects to "Invalid app" | Redirect URL on Kite console doesn't match `ZERODHA_REDIRECT_URL` | Update Kite console |
| LiveTicker shows "RECONNECTING" steadily | access_token expired (6 AM IST) | Re-do `/api/brokers/zerodha/login` |
| Backend crash loop on boot | `master.key` missing | `sudo bash deploy/scripts/setup-oracle-linux.sh` rebuilds it |

---

## What's still not done (Track B, weeks ahead)

1. Instruments master sync (Postgres + daily CSV pull)
2. Per-user multi-tenancy (today the scaffold is effectively single-user)
3. Encrypted tokens migrated from libsodium-on-disk → OCI Vault
4. Auth (email + OTP) gating `/` itself
5. Real `placeOrder` — only after Paper adapter contract tests pass and kill switch is wired
6. LLMGateway wiring for the AI Assistant drawer
7. SQLite/Postgres for audit log instead of flat file
8. Cloudflare in front of Nginx (WAF + DDoS)

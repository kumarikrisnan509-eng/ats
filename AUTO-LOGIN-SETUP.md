# Zerodha auto-login setup (host-side architecture)

> **Operator advisory.** This automates Zerodha's daily login UI. Zerodha's
> Kite Connect ToS forbids this. Detection may result in API access being
> disabled. Built at operator's explicit request — KILL_SWITCH stays `true`
> so a breach can only read live ticks, not place orders.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Host (Ubuntu)                              │
│  ┌──────────────────┐  ┌────────────────┐   │
│  │ cron 08:50 IST   │─▶│ morning-check.sh│   │
│  └──────────────────┘  └────────┬───────┘   │
│                                  │           │
│                                  ▼           │
│                     ┌──────────────────────┐ │
│                     │ auto-login-host.js   │ │
│                     │ (node + playwright)  │ │
│                     └──────┬───────────────┘ │
│                            │                 │
│   ┌──────────────┐ ┌───────▼──────┐          │
│   │  Telegram    │◀│  GET bundle  │          │
│   │   (notify)   │ │  POST exch   │          │
│   └──────────────┘ └───────┬──────┘          │
│                            │                 │
│         ┌──────────────────▼─────────────┐   │
│         │  ats-backend container (Alpine)│   │
│         │  Vault, KiteTicker, /api/*     │   │
│         └────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

The heavy parts (Chromium, Playwright) live on the host so the container stays small (~100 MB). The container exposes two loopback-only endpoints that the host script uses.

## One-time setup (~15 minutes)

### A. Install host-side dependencies

SSH to the VM:

```bash
ssh -i C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key ubuntu@141.148.192.4
```

Install Node + Playwright + Chromium on the host:

```bash
sudo apt update
sudo apt install -y nodejs npm
sudo npm install -g otplib playwright@1.49.1
sudo npx playwright install --with-deps chromium
# Verify
node --version       # should be v20+
sudo node -e "require('otplib'); require('playwright'); console.log('host deps ok')"
```

### B. Create Telegram bot

1. Message `@BotFather` on Telegram → `/newbot` → pick a name → save the bot token
2. Open your bot, send "hi"
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` → save the `chat.id`

### C. Capture your Kite TOTP seed

If you don't have it saved: kite.zerodha.com → Account → Settings → Disable 2FA → Enable 2FA → click "Can't scan? Get a code" → save the base32 seed.

### D. Add Telegram creds to `/etc/ats/backend.env`

```bash
sudo nano /etc/ats/backend.env
# append:
TELEGRAM_BOT_TOKEN=7891234567:AAH...xyz
TELEGRAM_CHAT_ID=123456789
# Ctrl+O, Enter, Ctrl+X

cd /opt/ats/compose && sudo docker compose down && sudo docker compose --env-file /opt/ats/compose/.env up -d
```

Test:
```bash
curl -sS -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/sendMessage" \
    -d "chat_id=<YOUR_CHAT_ID>" -d "text=hi from ATS"
```

### E. Seal your Kite credentials into the vault

```bash
sudo nano /tmp/kite-creds.json
```
```json
{
  "userId": "ARS209",
  "password": "your_kite_password",
  "totpSeed": "JBSWY3DPEHPK3PXP"
}
```

```bash
sudo bash /opt/ats/scripts/install-zerodha-creds.sh /tmp/kite-creds.json
```

After this, `/tmp/kite-creds.json` is shredded and `/var/lib/ats/secrets/zerodha-login.enc` exists.

### F. Place the host-side scripts

The CD pipeline syncs them to the VM. After the next deploy completes:

```bash
sudo cp /opt/ats/scripts/auto-login-host.js  /opt/ats/scripts/auto-login-host.js
sudo cp /opt/ats/scripts/morning-check.sh    /usr/local/bin/ats-morning-check.sh
sudo chmod +x /usr/local/bin/ats-morning-check.sh
sudo cp /opt/ats/scripts/ats-auto-login.cron /etc/cron.d/ats-auto-login
sudo chmod 0644 /etc/cron.d/ats-auto-login
sudo systemctl restart cron
```

### G. Test manually

```bash
sudo /usr/local/bin/ats-morning-check.sh
```

You should see in the script output:
- `bundle ok: userId=ARS209`
- `filled user_id + password`
- `generated TOTP (6 digits)`
- `captured request_token (length=NN)`
- `OK: ARS209 logged in.`

And a Telegram message: `✅ ATS auto-login OK`. Verify the connection:

```bash
curl -sS http://127.0.0.1:8080/api/health | python3 -m json.tool
# look for: "connected": true, "tickerInitialized": true
```

### H. Daily cron

`/etc/cron.d/ats-auto-login` fires at 03:20 UTC = 08:50 IST Mon-Fri. The script adds 0-60s random jitter. You receive Telegram on success or failure.

## Operations

| Event | Outcome |
|---|---|
| Cron fires 08:50 IST | Auto-login runs → Telegram "OK" or "FAILED" |
| Login fails | Screenshot at `/var/log/ats/autologin-failures/`, you log in manually via `https://ats.rajasekarselvam.com/api/brokers/zerodha/login` |
| Mid-day disconnect | KiteTicker reconnects with same access_token; you get pinged only if it can't |
| Credentials change | Re-run `install-zerodha-creds.sh` with a fresh JSON. Existing .enc overwritten. |
| Disable auto-login | `sudo rm /etc/cron.d/ats-auto-login && sudo systemctl restart cron` |

## Forensic review

| Path | What |
|---|---|
| `/var/log/ats/audit.log` | Every step: `autologin.bundle.served`, `autologin.connected`, `autologin.exchange.error`, … |
| `/var/log/ats/autologin-failures/*.png` | Full-page screenshots when the flow fails |
| `/var/log/ats-morning-check.log` | Output from the cron wrapper |
| `journalctl -u cron` | systemd-level cron events |

## Security

- TOTP seed + password encrypted with libsodium secretbox using `/etc/ats/master.key`
- Bundle endpoint (`/auto-login/bundle`) only responds to `127.0.0.1` requests carrying `X-ATS-Internal: 1`
- Plaintext credentials exist only in host script memory during the ~30-second auto-login run
- Container stays small and Playwright-free — no extra attack surface inside the container
- KILL_SWITCH=true means no order route exists, even if credentials leak

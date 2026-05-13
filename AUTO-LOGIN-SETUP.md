# Zerodha auto-login setup

> **Operator advisory.** This automates Zerodha's daily login UI. Zerodha's
> Kite Connect ToS forbids this. Detection may result in API access being
> disabled. Built at operator's explicit request — KILL_SWITCH stays `true`
> so a breach can only read live ticks, not place orders.

## One-time setup (~10 minutes)

### 1. Create a Telegram bot for alerts

1. On Telegram, message `@BotFather`
2. Send `/newbot`, follow the prompts. Pick any name + username ending in `_bot`.
3. BotFather replies with a **bot token** like `7891234567:AAH...xyz`. Save it.
4. Start a chat with your new bot (search for its username, click Start).
5. Send any message to your bot ("hi" works).
6. In a browser, open: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   The JSON response contains `"chat":{"id":<YOUR_CHAT_ID>,...}`. Save the chat_id.

### 2. Capture your Kite TOTP seed

If you already have TOTP set up but didn't save the seed, you'll need to disable + re-enable 2FA on kite.zerodha.com to capture it (it's shown ONCE during setup).

1. Log in to https://kite.zerodha.com → Account → Settings → Account
2. Under "Two-factor authentication" → Disable, then re-enable
3. When the QR code is shown, click **"Can't scan? Get a code"** — that's your **TOTP seed**, a base32 string like `JBSWY3DPEHPK3PXP`. Save it.
4. Use the QR to add to your authenticator app (Google Authenticator / Authy) as backup.

### 3. Add Telegram creds to `/etc/ats/backend.env`

SSH to the VM:

```bash
sudo nano /etc/ats/backend.env
# Append these two lines:
TELEGRAM_BOT_TOKEN=7891234567:AAH...xyz
TELEGRAM_CHAT_ID=123456789
# Save (Ctrl+O, Enter, Ctrl+X)

cd /opt/ats/compose && sudo docker compose down && sudo docker compose --env-file /opt/ats/compose/.env up -d
```

Test the bot reachability:
```bash
curl -sS -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/sendMessage" \
    -d "chat_id=<YOUR_CHAT_ID>" -d "text=hi from ATS"
```
You should get a message in Telegram immediately.

### 4. Encrypt your Kite credentials

On the VM, create a temporary JSON file:

```bash
sudo nano /tmp/kite-creds.json
```

Contents (replace with your actual values):
```json
{
  "userId": "ARS209",
  "password": "your_kite_password",
  "totpSeed": "JBSWY3DPEHPK3PXP"
}
```

Save and run the install script:

```bash
sudo bash /opt/ats/scripts/install-zerodha-creds.sh /tmp/kite-creds.json
```

Expected output: `sealed to /var/lib/ats/secrets/zerodha-login.enc` and the plaintext file is shredded. Verify the plaintext is gone:

```bash
ls -la /tmp/kite-creds.json   # should say: No such file or directory
sudo ls -la /var/lib/ats/secrets/   # should show zerodha-login.enc (mode 0600 root:root)
```

### 5. Test the auto-login manually

```bash
curl -sS -X POST -H 'X-ATS-Internal: 1' \
    http://127.0.0.1:8080/api/brokers/zerodha/auto-login
```

Expected response: `{"ok":true,"userId":"ARS209"}` within ~30s. You should also get a Telegram message:
> ✅ **ATS auto-login OK**
> Kite session established. Ticker connecting.

Verify connection:
```bash
curl -sS http://127.0.0.1:8080/api/health
# look for: "broker":{"name":"zerodha","connected":true,...}
```

### 6. Enable the daily cron

```bash
sudo cp /opt/ats/repo/deploy/cron/ats-auto-login.cron /etc/cron.d/ats-auto-login
sudo cp /opt/ats/repo/deploy/scripts/morning-check.sh /usr/local/bin/ats-morning-check.sh
sudo chmod +x /usr/local/bin/ats-morning-check.sh
sudo chmod 0644 /etc/cron.d/ats-auto-login
sudo systemctl restart cron
```

Verify the cron is scheduled:
```bash
sudo systemctl list-timers --all | grep cron
sudo cat /etc/cron.d/ats-auto-login
```

That's it. Tomorrow at 08:50 IST you'll get a Telegram message either "ATS auto-login OK" or "ATS auto-login FAILED" with the failure reason.

## Daily operations

- **08:50 IST every weekday**: cron fires automatically. Telegram pings you with the result.
- **If it fails**: open the public login URL on your phone, log in manually:
  `https://ats.rajasekarselvam.com/api/brokers/zerodha/login`
- **Mid-day disconnects**: backend will try to reconnect transparently. You'll get pinged if it can't.

## Rotating credentials

Run the install script again with a fresh JSON. It overwrites the sealed file:

```bash
sudo bash /opt/ats/scripts/install-zerodha-creds.sh /tmp/new-kite-creds.json
```

Restart container to be safe:
```bash
cd /opt/ats/compose && sudo docker compose restart
```

## Disabling auto-login (revert to manual)

```bash
sudo rm /etc/cron.d/ats-auto-login
sudo systemctl restart cron
```

The backend still supports manual `/api/brokers/zerodha/login` via your browser — only the daily cron is disabled.

## Forensic review

- **Audit log**: `/var/log/ats/audit.log` — every step (`autologin.start`, `autologin.totp_generated`, `autologin.success`, etc.) is recorded with timestamps
- **Failure screenshots**: `/var/log/ats/autologin-failures/autologin-<timestamp>.png` — full-page screenshots saved automatically when the flow fails
- **Cron log**: `/var/log/ats-morning-check.log` — output from the bash wrapper

## Security model

| Risk | Mitigation |
|---|---|
| Plaintext credentials leak | TOTP seed + password encrypted with libsodium secretbox using `/etc/ats/master.key` (root-only, 0444 for container readability). Plaintext exists only in container memory during auto-login. |
| Auto-login endpoint abused | Loopback-only (`127.0.0.1`) **plus** required `X-ATS-Internal: 1` header. Both checks must pass. Public nginx vhost doesn't proxy this route. |
| Stolen master.key + .enc + access token | KILL_SWITCH=true means no order route is reachable. Attacker can read live ticks, nothing else. |
| Zerodha detection / account ban | Random jitter on schedule + typing, realistic Chromium fingerprint, but no guarantee. Operator accepts this risk. |
| TOTP seed leaks via screenshot/log | Audit log redacts seeds. Telegram notifications never include credentials. Failure screenshots capture only the rendered page (no TOTP field is filled when failure occurs at TOTP step — Kite hides it). |

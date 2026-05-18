# Email Deliverability — SPF / DKIM / DMARC Setup

**v11-I7 (T-161).** Operator runbook for the DNS records that keep ATS transactional email out of spam folders.

Affects: signup verification, password reset, optional Telegram-down fallback alerts, and any future email digest features.

---

## Why this matters

Without SPF / DKIM / DMARC, mail providers (Gmail, Outlook, Yahoo) silently route ATS's transactional email to spam or reject it outright. Users will:

- Never receive their email verification link → can't activate their account
- Never receive password reset codes → locked out, must contact support
- Miss critical alerts when Telegram is also down

Gmail's 2024 "bulk sender" rules require all three records for any domain sending >5000 messages/day, but even at low volume the inbox-vs-spam outcome flips dramatically with these records in place.

## What to set on `rajasekarselvam.com`

Add three TXT records to your DNS provider. The exact UI varies (Cloudflare, GoDaddy, Route 53, etc.) but the record content is the same.

### 1. SPF — "who is allowed to send mail from this domain"

```
Type:   TXT
Name:   @                       (the apex / bare domain)
Value:  v=spf1 include:_spf.<your-mail-provider>.com ~all
TTL:    3600 (1h)
```

Replace `<your-mail-provider>` with whatever you actually use:

| Provider | `include:` value |
|---|---|
| Gmail / Google Workspace | `_spf.google.com` |
| AWS SES | `amazonses.com` |
| SendGrid | `sendgrid.net` |
| Mailgun | `mailgun.org` |
| Postmark | `spf.mtasv.net` |
| Resend | `_spf.resend.com` |

**`~all`** = "soft fail other senders" (recommended). Use `-all` once you've verified everything works for a full week with no false positives.

### 2. DKIM — "this message was actually signed by my mail provider's key"

The selector and value come from your mail provider's settings page. Example for SendGrid:

```
Type:   TXT
Name:   s1._domainkey            (the selector — provider tells you)
Value:  v=DKIM1; k=rsa; p=MIIBIjANBgkq…      (long public-key blob)
TTL:    3600
```

The `Name` is `<selector>._domainkey` — the selector is whatever your provider chose (often `s1`, `s2`, `google`, `k1`, etc.). Each provider gives you the exact record to paste.

### 3. DMARC — "what should receivers do when SPF/DKIM fail"

```
Type:   TXT
Name:   _dmarc                   (literally _dmarc, no domain suffix)
Value:  v=DMARC1; p=none; rua=mailto:dmarc@rajasekarselvam.com; pct=100
TTL:    3600
```

Start with `p=none` (report only, don't reject yet). After 1–2 weeks of reports:
- **No issues** → upgrade to `p=quarantine; pct=25` (quarantine 25% of failures)
- **A few weeks more clean** → `p=quarantine; pct=100`
- **Eventually** → `p=reject` (strictest, most protection against spoofing)

The `rua=mailto:` address gets weekly aggregate XML reports — set up an email forwarder for it; the reports are unreadable as XML but [dmarcian.com](https://dmarcian.com/) and similar free tools convert them.

## After adding records

1. Wait 1–4 hours for DNS propagation (TTL-dependent).
2. Run `deploy/scripts/check-email-deliverability.sh` — it dig-queries all three records and reports pass/fail.
3. Send a test signup verification email to a Gmail account; check the message's "Show original" page — all three should show **PASS**.

## How ATS sends email today

The backend currently uses [email-alerts.js](../backend/email-alerts.js) — a stub that logs to console only. Wiring up a real provider (SendGrid free tier, AWS SES, or Resend) is a separate operator task. Whichever you pick, set:

```
# /etc/ats/backend.env on the VM
SMTP_HOST=...           # e.g. smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...           # ← never commit, set on the VM via setup-all.sh
SMTP_FROM=no-reply@rajasekarselvam.com
```

Then restart the container. `notify.js` already gracefully degrades if SMTP isn't configured (mirrors the Telegram `ENABLED` pattern from T-153/T-154).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Gmail says SPF=NONE | TXT record not yet propagated | Wait an hour, re-check `dig TXT rajasekarselvam.com` |
| Gmail says DKIM=FAIL | Wrong selector or wrong public key | Re-copy the value from your provider's setup page — pay attention to line breaks |
| Gmail says DMARC=FAIL with SPF/DKIM=PASS | Domain alignment mismatch (e.g. mail-from is `bounce.sendgrid.net`) | Set `relaxed` alignment: `v=DMARC1; p=none; adkim=r; aspf=r; rua=...` |
| dmarc reports show 100% pass but mail still spam | Reputation, not records | Warm the IP with low-volume sends first; ensure From: is a real-looking address |

## See also

- [INCIDENT-RUNBOOK](INCIDENT-RUNBOOK.md) — what to do if outbound email stops working entirely
- [SECRETS](../../SECRETS.md) — where SMTP credentials live
- Google's [bulk sender guidelines](https://support.google.com/a/answer/81126) — the canonical reference

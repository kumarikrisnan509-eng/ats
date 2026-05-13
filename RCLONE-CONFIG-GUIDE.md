# rclone config walkthrough — ATS audit archive

You picked **"Run rclone config directly on the VM"** + **"a dedicated Google account."**
This file is the step-by-step for the interactive part.

The non-interactive bits (apt install rclone, logrotate config, cron skeleton) are already
done by `SETUP-RCLONE-ARCHIVE.cmd`. The cron is **disabled** until you finish this guide.

---

## 1. SSH into the VM

Open a fresh Windows PowerShell (or git-bash) on your laptop and run:

```
ssh -i C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key ubuntu@141.148.192.4
```

You should be at `ubuntu@<hostname>:~$`.

---

## 2. Start the rclone config wizard

```
sudo rclone config
```

Then follow the prompts exactly as below. Anything in **bold** is what you type/select.

| Prompt | Your answer | Why |
|---|---|---|
| `e/n/d/r/c/s/q>` | **n** | New remote |
| `name>` | **ats-archive** | Must match what `setup-rclone-archive.sh` expects |
| `Storage>` | **drive** | Google Drive |
| `client_id>` | (just press Enter) | Use rclone's default OAuth client — fine for personal use, rate-limited but plenty for daily audit log |
| `client_secret>` | (just press Enter) | Same |
| `scope>` | **1** | Full Drive access. (Option 1 = "drive", full RW) |
| `service_account_file>` | (just press Enter) | Not using service account |
| `Edit advanced config?` | **n** | No |
| `Use auto config?` | **n** | **CRITICAL: pick "n"** — the VM has no GUI browser, so we can't auto-launch. We'll use the manual flow. |
| | rclone prints a long URL like `https://accounts.google.com/o/oauth2/auth?...` and waits for a verification code | |
| **On your laptop**: copy that URL → paste into your laptop browser | | |
| Sign in with the **dedicated Google account** you want for ATS audit archive | | |
| Click "Allow" on the rclone permissions screen | | |
| Google shows a verification code — copy it | | |
| Back in the SSH session, paste the code at the `Enter verification code>` prompt | | |
| `Configure this as a Shared Drive (Team Drive)?` | **n** | Personal Drive |
| Review the config block. `y/e/d>` | **y** | Confirm |
| `e/n/d/r/c/s/q>` | **q** | Quit the wizard |

---

## 3. Verify the remote works

Still in the SSH session:

```
sudo rclone lsd ats-archive:
```

Expected: either an empty list, or any folders you already have in that Google Drive.
If you see an authentication error, repeat step 2 — the OAuth probably failed.

Optional smoke test — create the target folder + upload a dummy file:

```
sudo rclone mkdir ats-archive:ats-audit-archive
echo "hello from VM $(date)" | sudo tee /tmp/rclone-test.txt
sudo rclone copy /tmp/rclone-test.txt ats-archive:ats-audit-archive/
sudo rclone ls ats-archive:ats-audit-archive/
```

You should see `rclone-test.txt` listed. Check the Google Drive in a browser
and you should see the `ats-audit-archive/` folder with that file inside.

Clean up the test file:
```
sudo rclone delete ats-archive:ats-audit-archive/rclone-test.txt
```

---

## 4. Tell me — I'll enable the cron

Once `rclone lsd ats-archive:` succeeds, message me back. I'll run a
short script that:

1. Moves `/etc/cron.d/ats-audit-rclone.disabled` → `/etc/cron.d/ats-audit-rclone` (activates it)
2. Triggers `logrotate` once to test the rotation produces a `.gz` file
3. Triggers the archive wrapper once to confirm a real upload works
4. Tails the rclone log to show the result

After that, daily at 02:30 UTC the VM will automatically:
- logrotate runs at its scheduled time → `audit.log` is rotated to `audit.log-YYYY-MM-DD.gz`
- cron runs the wrapper → rotated `.gz` files are copied to `gdrive:ats-audit-archive/`
- Last 7 days kept locally, all older days in GDrive

---

## Troubleshooting

**"Auto config failed" or browser opened on VM (XFCE):**
You picked `y` instead of `n` for "Use auto config?". Press Ctrl+C, run `sudo rclone config` again, pick `n` this time.

**"Token has been expired or revoked":**
Run `sudo rclone config reconnect ats-archive:` and repeat the OAuth flow.

**Need to switch Google account later:**
`sudo rclone config delete ats-archive` then start over from step 2.

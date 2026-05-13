#!/usr/bin/env bash
# install-zerodha-creds.sh
#
# One-time setup: encrypts Kite login creds (user_id, password, TOTP seed)
# with the existing libsodium master key and writes them to
# /var/lib/ats/secrets/zerodha-login.enc.
#
# Run as: sudo bash install-zerodha-creds.sh /path/to/plaintext-creds.txt
#
# The plaintext file MUST be a JSON object:
#   {"userId":"ARS209","password":"...","totpSeed":"BASE32SECRET"}
#
# After successful seal, this script:
#   1. shreds the plaintext input file
#   2. prints the path of the .enc
#   3. asks the container to re-read (compose restart)
set -euo pipefail

INPUT="${1:?usage: install-zerodha-creds.sh /path/to/creds.json}"
ENC_OUT="/var/lib/ats/secrets/zerodha-login.enc"
MASTER_KEY="/etc/ats/master.key"

if [ ! -f "$INPUT" ]; then
    echo "ERROR: $INPUT not found"; exit 1
fi
if [ ! -f "$MASTER_KEY" ]; then
    echo "ERROR: $MASTER_KEY not found"; exit 1
fi

echo "==> Validating input JSON"
python3 -c "
import json, sys
with open('$INPUT') as f:
    d = json.load(f)
for k in ('userId','password','totpSeed'):
    if not d.get(k):
        print(f'ERROR: missing or empty \"{k}\"'); sys.exit(1)
print('  userId:', d['userId'])
print('  totpSeed length:', len(d['totpSeed']))
"

echo
echo "==> Sealing via Node + libsodium"
sudo mkdir -p "$(dirname "$ENC_OUT")"

# We use docker exec into the running container to keep deps consistent.
# If the container isn't running, fall back to host node.
if sudo docker ps --filter name=ats-backend --filter status=running --format '{{.Names}}' | grep -q '^ats-backend$'; then
    echo "  (using ats-backend container)"
    sudo cp "$INPUT" /var/lib/ats/secrets/.tmp-creds.json
    sudo chmod 0644 /var/lib/ats/secrets/.tmp-creds.json
    sudo docker exec ats-backend node -e "
        (async () => {
          const fs = require('fs');
          const { Vault } = require('/app/crypto-vault');
          const { LoginVault } = require('/app/login-vault');
          const vault = await Vault.open('/run/secrets/master.key');
          const json = fs.readFileSync('/var/lib/ats/secrets/.tmp-creds.json', 'utf8');
          const creds = JSON.parse(json);
          const lv = new LoginVault(vault);
          const out = await lv.save(creds);
          console.log('  sealed to', out);
        })().catch(e => { console.error(e); process.exit(1); });
    "
    sudo shred -u /var/lib/ats/secrets/.tmp-creds.json 2>/dev/null || sudo rm -f /var/lib/ats/secrets/.tmp-creds.json
else
    echo "ERROR: ats-backend container is not running; start it first."
    exit 2
fi

echo
echo "==> Shredding plaintext input"
sudo shred -u "$INPUT" 2>/dev/null || sudo rm -f "$INPUT"

echo
echo "==> Result:"
sudo ls -lah "$ENC_OUT"
echo
echo "Done. The container can now auto-login via POST /api/brokers/zerodha/auto-login."
echo "Test with:"
echo "  curl -X POST -H 'X-ATS-Internal: 1' http://127.0.0.1:8080/api/brokers/zerodha/auto-login"

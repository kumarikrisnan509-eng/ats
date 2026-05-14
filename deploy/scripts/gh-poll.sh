#!/usr/bin/env bash
# gh-poll.sh -- wait for CI + deploy of a specific commit SHA, then verify health.
# Usage: ./gh-poll.sh <commit-sha-prefix>
set -uo pipefail
OWNER="${OWNER:-mohanapriya63085}"
REPO="${REPO:-ats}"
PAT="${PAT:-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}"
SHA="${1:?provide commit sha prefix}"

API="https://api.github.com/repos/${OWNER}/${REPO}"

for i in $(seq 1 60); do
  RESP=$(curl -sS -H "Authorization: Bearer ${PAT}" "${API}/actions/runs?per_page=6")
  STATUS=$(echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ci=next((r for r in d.get('workflow_runs',[]) if r['name']=='ci' and r['head_sha'].startswith('${SHA}')), None)
dp=next((r for r in d.get('workflow_runs',[]) if r['name']=='deploy' and r['head_sha'].startswith('${SHA}')), None)
ci_str = (ci['status']+'/'+(ci['conclusion'] or '-')) if ci else 'queued'
dp_str = (dp['status']+'/'+(dp['conclusion'] or '-')) if dp else 'queued'
print(f'ci={ci_str}  deploy={dp_str}')
done = bool(dp and dp['status']=='completed')
fail = bool(ci and ci['status']=='completed' and ci['conclusion']!='success')
print('DONE' if done else 'FAIL' if fail else 'WAIT')
")
  LINE=$(echo "$STATUS" | head -1)
  STATE=$(echo "$STATUS" | tail -1)
  printf "  [%2d/60] %s\n" "$i" "$LINE"
  if [ "$STATE" = "DONE" ]; then break; fi
  if [ "$STATE" = "FAIL" ]; then echo "  CI failed -- aborting"; exit 1; fi
  sleep 20
done

echo
echo "Health check:"
sleep 8
curl -s --max-time 10 https://ats.rajasekarselvam.com/api/health | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print(f'  uptime={d[\"uptimeSec\"]}s  broker={d[\"broker\"][\"connected\"]}')
except Exception as e:
    print(f'  err: {e}')
"

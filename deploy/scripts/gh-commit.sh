#!/usr/bin/env bash
# gh-commit.sh -- commit + push files via GitHub REST API.
# Bypasses local .git entirely so it works even when HEAD.lock is stuck on Windows.
#
# Usage:
#   ./gh-commit.sh "<commit-message>" file1 file2 file3 ...
#
# Reads each file from the working tree, creates blobs, builds a tree on top of
# the current main branch, creates a commit, and fast-forwards refs/heads/main.

set -euo pipefail

OWNER="${OWNER:-mohanapriya63085}"
REPO="${REPO:-ats}"
BRANCH="${BRANCH:-main}"
PAT="${PAT:-${GH_PAT:-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}}"
API="https://api.github.com/repos/${OWNER}/${REPO}"

MSG="${1:-tier9: automated commit via GitHub API}"
shift

if [ "$#" -eq 0 ]; then echo "no files given" >&2; exit 1; fi

api() {
  curl -sS -H "Authorization: Bearer ${PAT}" -H "Accept: application/vnd.github+json" "$@"
}

echo "[1/5] Fetch current main SHA"
PARENT_SHA=$(api "${API}/git/ref/heads/${BRANCH}" | python3 -c "import json,sys;print(json.load(sys.stdin)['object']['sha'])")
echo "  parent: ${PARENT_SHA:0:12}"

echo "[2/5] Fetch parent tree SHA"
BASE_TREE=$(api "${API}/git/commits/${PARENT_SHA}" | python3 -c "import json,sys;print(json.load(sys.stdin)['tree']['sha'])")
echo "  base tree: ${BASE_TREE:0:12}"

echo "[3/5] Upload each file as a blob"
TREE_ITEMS="["
COMMA=""
for FILE in "$@"; do
  if [ ! -f "$FILE" ]; then echo "  skip (missing): $FILE"; continue; fi
  CONTENT_B64=$(base64 -w0 < "$FILE")
  BLOB_SHA=$(api -X POST "${API}/git/blobs" \
    -d "$(python3 -c "import json,sys;print(json.dumps({'content':'${CONTENT_B64}','encoding':'base64'}))")" \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['sha'])")
  echo "  $(printf '%-50s' "$FILE") -> blob ${BLOB_SHA:0:12}"
  TREE_ITEMS+="${COMMA}{\"path\":\"${FILE}\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"${BLOB_SHA}\"}"
  COMMA=","
done
TREE_ITEMS+="]"

echo "[4/5] Create tree on top of base"
TREE_JSON=$(python3 -c "import json,sys;print(json.dumps({'base_tree':'${BASE_TREE}','tree':json.loads('''${TREE_ITEMS}''')}))")
TREE_SHA=$(api -X POST "${API}/git/trees" -d "$TREE_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin)['sha'])")
echo "  new tree: ${TREE_SHA:0:12}"

echo "[5/5] Create commit + advance ref"
COMMIT_BODY=$(python3 -c "
import json
print(json.dumps({
  'message': '''$(echo "${MSG}" | sed "s/'/\\\\'/g")''',
  'tree': '${TREE_SHA}',
  'parents': ['${PARENT_SHA}'],
  'author': {'name':'ats-bot','email':'ats-bot@local','date':'$(date -u +%FT%TZ)'}
}))")
COMMIT_SHA=$(api -X POST "${API}/git/commits" -d "$COMMIT_BODY" | python3 -c "import json,sys;print(json.load(sys.stdin)['sha'])")
echo "  new commit: ${COMMIT_SHA:0:12}"

# Update ref
api -X PATCH "${API}/git/refs/heads/${BRANCH}" -d "$(python3 -c "import json;print(json.dumps({'sha':'${COMMIT_SHA}','force':False}))")" | python3 -c "import json,sys;d=json.load(sys.stdin);print('  ref updated:',d.get('ref'),'->',d['object']['sha'][:12])"

echo
echo "  Push complete. CI + deploy will run automatically on commit ${COMMIT_SHA:0:12}."

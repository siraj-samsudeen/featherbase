#!/usr/bin/env bash
# Differential oracle check (adopted from the PR-2 harness): fire the SAME
# request at a real Frappe instance and at the clone, normalize volatile
# fields, and deep-diff. Empty diff + matching status codes = parity.
#
# Usage:
#   FRAPPE_REF=http://localhost:8080 CLONE=http://localhost:8000 \
#     ./diff-request.sh <id> <METHOD> <path> [json-body]
#
# Auth: both systems are logged into via Frappe's /api/method/login
# (REF_USR/REF_PWD, CLONE_USR/CLONE_PWD; defaults Administrator/admin) with
# sid-cookie sessions — which the clone supports natively.
# Output lands in harness/evidence/<id>/: ref.json, clone.json, diff.txt.
set -euo pipefail

ID=${1:?usage: diff-request.sh <id> <METHOD> <path> [json-body]}
METHOD=${2:?}
REQ_PATH=${3:?}
BODY=${4:-}

REF=${FRAPPE_REF:?set FRAPPE_REF to the real-Frappe base URL}
CLONE=${CLONE:-http://localhost:8000}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../evidence/$ID"
mkdir -p "$OUT"

login() { # base user pwd jar
  curl -sf -c "$4" -X POST "$1/api/method/login" \
    -H 'content-type: application/json' \
    -d "{\"usr\":\"$2\",\"pwd\":\"$3\"}" > /dev/null
}

fire() { # base jar outfile -> echoes status code
  local args=(-s -b "$2" -o "$3.raw" -w '%{http_code}' -X "$METHOD" "$1$REQ_PATH")
  [ -n "$BODY" ] && args+=(-H 'content-type: application/json' -d "$BODY")
  curl "${args[@]}"
}

login "$REF" "${REF_USR:-Administrator}" "${REF_PWD:-admin}" "$OUT/ref.jar"
login "$CLONE" "${CLONE_USR:-Administrator}" "${CLONE_PWD:-admin}" "$OUT/clone.jar"

REF_CODE=$(fire "$REF" "$OUT/ref.jar" "$OUT/ref")
CLONE_CODE=$(fire "$CLONE" "$OUT/clone.jar" "$OUT/clone")

jq -S -f "$HERE/normalize.jq" "$OUT/ref.raw" > "$OUT/ref.json"
jq -S -f "$HERE/normalize.jq" "$OUT/clone.raw" > "$OUT/clone.json"

{
  echo "status: ref=$REF_CODE clone=$CLONE_CODE"
  diff -u "$OUT/ref.json" "$OUT/clone.json" && echo "BODY DIFF: empty"
} | tee "$OUT/diff.txt"

[ "$REF_CODE" = "$CLONE_CODE" ] || { echo "STATUS MISMATCH" | tee -a "$OUT/diff.txt"; exit 1; }

#!/usr/bin/env bash
# Session loop: run the coding agent repeatedly, with an evaluator pass after
# every EVAL_EVERY coding sessions. Each `claude -p` invocation is one fresh
# context window; all continuity lives in the repo (git, PROGRESS.md,
# harness/features.json) — that is the whole point of the harness.
#
# Usage: harness/run.sh [max_sessions]   (default 20)
# Requires: claude CLI authenticated; run from the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

MAX_SESSIONS="${1:-20}"
EVAL_EVERY="${EVAL_EVERY:-3}"

if [ ! -f package.json ]; then
  echo "==> No scaffold yet: running initializer session"
  claude -p "$(cat harness/prompts/initializer.md)" \
    --permission-mode acceptEdits --max-turns 200
fi

remaining() {
  node -e "const f=require('./harness/features.json');console.log(f.features.filter(x=>x.status==='failing').length)"
}

for i in $(seq 1 "$MAX_SESSIONS"); do
  left="$(remaining)"
  echo "==> Session $i/$MAX_SESSIONS — $left features failing"
  [ "$left" = 0 ] && { echo "==> All features passing. Done."; break; }

  claude -p "$(cat harness/prompts/coder.md)" \
    --permission-mode acceptEdits --max-turns 300 || true

  if [ $(( i % EVAL_EVERY )) -eq 0 ]; then
    echo "==> Evaluator pass"
    claude -p "$(cat harness/prompts/evaluator.md)" \
      --permission-mode acceptEdits --max-turns 150 || true
  fi

  git push -u origin "$(git branch --show-current)" || true
done

echo "==> Loop finished. $(remaining) features still failing."

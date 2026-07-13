#!/usr/bin/env bash
# The pre-PR gate: everything ci.yml runs PLUS the Playwright E2E suite
# (which GitHub Actions doesn't run yet — see docs/e2e-testing.md). On
# success, writes .git/preflight-ok containing a hash of the exact
# working-tree content; the PreToolUse hook wired in .claude/settings.json
# refuses PR creation while that marker is missing or stale.
#
# PREFLIGHT_SKIP_E2E=1 skips the Playwright stage (recorded in the marker) —
# an explicit human override for environments that can't run a browser.
set -euo pipefail
cd "$(dirname "$0")/.."

# Content hash of the working tree (tracked + untracked, respecting
# .gitignore), independent of HEAD — committing unchanged content keeps the
# marker fresh, while any file edit invalidates it.
tree_hash() {
  local tmp
  tmp=$(mktemp)
  cp .git/index "$tmp" 2>/dev/null || true
  GIT_INDEX_FILE="$tmp" git add -A >/dev/null 2>&1
  GIT_INDEX_FILE="$tmp" git write-tree
  rm -f "$tmp"
}

# Unlike ci.yml (which runs on a clean checkout and can `git diff` the whole
# tree), preflight may run alongside uncommitted work — so drift checks are
# scoped to the generated paths.
generated=(
  apps/web/convex/_generated
  apps/web/convex/doctypes.gen.ts
  apps/web/convex/hooks.gen.ts
  apps/web/src/routeTree.gen.ts
)

echo "==> Convex codegen drift check"
(cd apps/web && npx convex codegen --system-udfs --typecheck disable)
git diff --exit-code -- "${generated[@]}"

echo "==> DocType codegen drift check"
npm run gen:doctypes
git diff --exit-code -- "${generated[@]}"

echo "==> Lint"
npm run lint

echo "==> Format check"
npm run format:check

echo "==> Typecheck"
npm run typecheck

echo "==> Tests (coverage-gated)"
npm run test:coverage

echo "==> Build"
npm run build

if [ "${PREFLIGHT_SKIP_E2E:-}" = "1" ]; then
  echo "==> Playwright E2E: SKIPPED (PREFLIGHT_SKIP_E2E=1)"
  e2e_status="skipped"
else
  echo "==> Playwright E2E (real local stack)"
  npm run test:e2e
  e2e_status="passed"
fi

echo "==> Generated-files drift check"
git diff --exit-code -- "${generated[@]}"

{
  echo "tree=$(tree_hash)"
  echo "e2e=$e2e_status"
  echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > .git/preflight-ok

echo "Preflight green (e2e: $e2e_status) — marker written to .git/preflight-ok."

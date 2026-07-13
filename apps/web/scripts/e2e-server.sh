#!/usr/bin/env bash
# Boot the full local stack for Playwright: an anonymous local Convex
# deployment (no account needed) with Convex Auth key material provisioned,
# plus the Vite dev server. Used as playwright.config.ts's webServer command.
set -euo pipefail
cd "$(dirname "$0")/.."

export CONVEX_AGENT_MODE=anonymous

# Ensure the deployment exists and the current functions/schema are pushed.
npx convex dev --once --typecheck disable

# Idempotent: generates JWT_PRIVATE_KEY/JWKS/SITE_URL if missing (the
# non-interactive stand-in for `npx @convex-dev/auth`).
node scripts/provision-auth-env.mjs

# Run `convex dev` as a child (NOT exec — exec would drop the trap): when
# Playwright tears the webServer down, the trap forwards the signal to the
# whole process group so the backend and vite die promptly, then restores
# the canonical --system-udfs codegen that dev mode rewrites (the form the
# CI drift check rejects — see CLAUDE.md gotchas).
cleanup() {
  [ -n "${child:-}" ] && kill -- -"$child" 2>/dev/null
  wait 2>/dev/null || true
  git checkout -- convex/_generated 2>/dev/null || true
}
trap cleanup EXIT TERM INT

# Job control (-m) puts the background job in its own process group — the
# portable form of setsid, which macOS lacks.
set -m
npx convex dev --typecheck disable --tail-logs disable \
  --start "npx vite --port 5173 --strictPort" &
child=$!
set +m
wait "$child"

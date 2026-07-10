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

# Keep `convex dev` and restore the canonical --system-udfs codegen on exit:
# dev mode rewrites convex/_generated in a form the CI drift check rejects
# (see CLAUDE.md gotchas).
trap 'git checkout -- convex/_generated 2>/dev/null || true' EXIT

exec npx convex dev --typecheck disable --tail-logs disable \
  --start "npx vite --port 5173 --strictPort"

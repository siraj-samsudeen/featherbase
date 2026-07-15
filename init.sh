#!/usr/bin/env bash
# Boot the entire stack and smoke-test it. Every agent session runs this first.
# The initializer agent replaces the placeholder sections as the scaffold lands;
# keep this script working at all times (see CLAUDE.md).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> frappe-clone init"

# --- 1. Dependencies -------------------------------------------------------
if [ -f package.json ]; then
  command -v pnpm >/dev/null || npm install -g pnpm
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
else
  echo "!! No package.json yet — run the initializer agent (harness/prompts/initializer.md)"
  exit 1
fi

# --- 2. Database -----------------------------------------------------------
if [ -f supabase/config.toml ] && command -v supabase >/dev/null; then
  supabase status >/dev/null 2>&1 || supabase start
elif [ -f docker-compose.yml ]; then
  docker compose up -d db
else
  echo "!! No database configuration yet — initializer agent must set this up"
  exit 1
fi

# --- 3. Migrations ---------------------------------------------------------
pnpm --filter server migrate

# --- 4. App servers (idempotent: kill stale, start fresh, wait for health) --
pkill -f "apps/server.*dev" 2>/dev/null || true
pkill -f "vite.*apps/web" 2>/dev/null || true
pnpm --filter server dev >/tmp/frappe-clone-server.log 2>&1 &
pnpm --filter web dev >/tmp/frappe-clone-web.log 2>&1 &

for i in $(seq 1 30); do
  curl -sf http://localhost:8000/api/ping >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "!! server failed to boot; see /tmp/frappe-clone-server.log"; exit 1; }
  sleep 1
done
for i in $(seq 1 30); do
  curl -sf http://localhost:5173 >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "!! web failed to boot; see /tmp/frappe-clone-web.log"; exit 1; }
  sleep 1
done

# --- 5. Smoke test ----------------------------------------------------------
pnpm smoke

echo "==> init OK — server :8000, web :5173"

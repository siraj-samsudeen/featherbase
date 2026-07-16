#!/usr/bin/env bash
# Boot the entire stack and smoke-test it. Every agent session runs this first.
# Keep this script working at all times (see CLAUDE.md).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> frappe-clone init"

# --- 1. Dependencies -------------------------------------------------------
command -v pnpm >/dev/null || npm install -g pnpm
[ -d node_modules ] || pnpm install

# --- 2. Database (system Postgres 16 cluster, port 5432) --------------------
if ! pg_lsclusters 2>/dev/null | grep -q "16.*main.*online"; then
  pg_ctlcluster 16 main start
fi
su postgres -c "psql -tAc \"ALTER USER postgres PASSWORD 'postgres'\"" >/dev/null
su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='frappe_clone'\"" | grep -q 1 \
  || su postgres -c "createdb frappe_clone"

# --- 3. Migrations ---------------------------------------------------------
pnpm --filter server migrate

# --- 4. App servers (idempotent: kill stale, start fresh, wait for health) --
# Kill by listening port — pattern-matching the tsx wrapper misses the actual
# node child that holds the port (and its in-process meta cache).
for port in 8000 5173; do
  pids="$(fuser "${port}/tcp" 2>/dev/null || true)"
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
done
pkill -f "tsx watch src/index.ts" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 2
(cd apps/server && nohup pnpm dev >/tmp/frappe-clone-server.log 2>&1 &)
(cd apps/web && nohup pnpm dev >/tmp/frappe-clone-web.log 2>&1 &)

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

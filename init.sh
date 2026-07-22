#!/usr/bin/env bash
# Boot the entire stack and smoke-test it. Every agent session runs this first.
# Keep this script working at all times (see CLAUDE.md).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> featherbase init"

# --- 1. Dependencies -------------------------------------------------------
command -v pnpm >/dev/null || npm install -g pnpm
[ -d node_modules ] || pnpm install

# --- 2. Database -----------------------------------------------------------
# DATABASE_URL is the single source of truth; the default below must stay in
# sync with apps/server/src/config.ts. We never manage a server that is already
# serving that URL — on the container, and on any second run, this whole block
# is a no-op. Only when the URL does not answer do we try to start a cluster
# and create the role/database, branching by platform at that point.
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/featherbase}"

if ! command -v psql >/dev/null; then
  echo "--> psql not found; skipping database bootstrap (migrate will report if"
  echo "    DATABASE_URL is unreachable)"
else
  # Parse the URL with node rather than bash regex. \x1f (unit separator) keeps
  # an empty password from collapsing into the next field.
  IFS=$'\x1f' read -r DB_USER DB_PASS DB_HOST DB_PORT DB_NAME <<EOF
$(node -e "const u=new URL(process.argv[1]);process.stdout.write([decodeURIComponent(u.username)||'postgres',decodeURIComponent(u.password),u.hostname||'127.0.0.1',u.port||'5432',decodeURIComponent(u.pathname.slice(1))].join('\x1f'))" "$DATABASE_URL")
EOF

  db_url_ok() { PGCONNECT_TIMEOUT=5 psql "$DATABASE_URL" -tAc 'select 1' >/dev/null 2>&1; }

  if ! db_url_ok; then
    # (a) Is anything listening at all? If not, try to start the local cluster.
    if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
      echo "--> no Postgres on $DB_HOST:$DB_PORT — attempting to start one"
      if command -v pg_ctlcluster >/dev/null; then
        # Debian/Ubuntu (the container): start whichever cluster owns the port,
        # falling back to the first one defined.
        cl="$(pg_lsclusters -h 2>/dev/null | awk -v p="$DB_PORT" '$3==p {print $1, $2; exit}')"
        [ -n "$cl" ] || cl="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1 {print $1, $2}')"
        # shellcheck disable=SC2086
        [ -n "$cl" ] && pg_ctlcluster $cl start || true
      elif command -v brew >/dev/null; then
        # macOS/Homebrew: whatever postgresql formula is installed.
        svc="$(brew list --formula 2>/dev/null | grep '^postgresql' | head -1)"
        [ -n "$svc" ] && brew services start "$svc" || true
      fi
      for i in $(seq 1 20); do
        pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1 && break
        [ "$i" = 20 ] && {
          echo "!! could not reach Postgres at $DB_HOST:$DB_PORT."
          echo "   Start a server there, or point DATABASE_URL at a running one."
          exit 1
        }
        sleep 1
      done
    fi

    # (b) The server is up but the URL still fails — the role or the database
    #     is missing. Find a superuser connection this host will accept.
    ADMIN_URL=""
    SU_POSTGRES=0
    for u in "$(id -un)" postgres; do
      [ -n "$ADMIN_URL" ] && continue
      cand="postgres://$u@$DB_HOST:$DB_PORT/postgres"
      PGCONNECT_TIMEOUT=5 psql "$cand" -tAc 'select 1' >/dev/null 2>&1 && ADMIN_URL="$cand"
    done
    if [ -z "$ADMIN_URL" ] && [ "$(id -u)" = 0 ] && id postgres >/dev/null 2>&1; then
      SU_POSTGRES=1   # container: peer auth over the local socket
    fi
    if [ -z "$ADMIN_URL" ] && [ "$SU_POSTGRES" = 0 ]; then
      echo "!! Postgres is running on $DB_HOST:$DB_PORT but DATABASE_URL does not"
      echo "   work and no superuser connection is available to fix it."
      echo "   Create role '$DB_USER' and database '$DB_NAME' by hand, or set"
      echo "   DATABASE_URL to credentials that already exist."
      exit 1
    fi

    admin_sql() {  # $1 = SQL, printed result on stdout
      if [ -n "$ADMIN_URL" ]; then psql "$ADMIN_URL" -tAc "$1"
      else su postgres -c "psql -tAc \"$1\""; fi
    }

    if [ "$(admin_sql "select 1 from pg_roles where rolname='$DB_USER'")" = 1 ]; then
      admin_sql "alter role \"$DB_USER\" password '$DB_PASS'" >/dev/null
    else
      echo "--> creating Postgres role '$DB_USER'"
      admin_sql "create role \"$DB_USER\" login superuser password '$DB_PASS'" >/dev/null
    fi
    if [ "$(admin_sql "select 1 from pg_database where datname='$DB_NAME'")" != 1 ]; then
      echo "--> creating database '$DB_NAME'"
      admin_sql "create database \"$DB_NAME\" owner \"$DB_USER\"" >/dev/null
    fi

    db_url_ok || { echo "!! DATABASE_URL still unreachable after bootstrap"; exit 1; }
  fi
fi

# --- 3. Migrations + patches -----------------------------------------------
pnpm --filter server migrate
pnpm --filter server patches

# --- 4. App servers (idempotent: kill stale, start fresh, wait for health) --
# Kill by listening port — pattern-matching the tsx wrapper misses the actual
# node child that holds the port (and its in-process meta cache).
# macOS ships a `fuser` that rejects the `PORT/tcp` syntax, so prefer lsof.
for port in 8000 5173; do
  if command -v lsof >/dev/null; then
    pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  else
    pids="$(fuser "${port}/tcp" 2>/dev/null || true)"
  fi
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
done
pkill -f "tsx watch src/index.ts" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 2
# `exec` so the subshell becomes the dev server rather than lingering as a
# parent that still holds this script's stdout — on macOS such a subshell
# outlives the script and `./init.sh | tee` never sees EOF.
(cd apps/server && exec nohup pnpm dev >/tmp/frappe-clone-server.log 2>&1) &
(cd apps/web && exec nohup pnpm dev >/tmp/frappe-clone-web.log 2>&1) &

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

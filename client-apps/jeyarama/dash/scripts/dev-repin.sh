#!/usr/bin/env bash
# Local development only (README, "Local development"). The platform
# fingerprints the whole app folder, so after a server-module edit the
# featherbase dev server restarts and finds the installed feather_dash no
# longer matching its folder: the app is unavailable. This re-pins the dev
# database's install to the folder as it is now, then nudges the dev server
# to restart and pick it up. It never runs against a database that is not
# stamped `development`, and it refuses when featherbase.json changed (a
# manifest change needs a fresh dev database, as an instance would need an
# upgrade).
#
#   DATABASE_URL=<dev database> npm run dev:repin
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the database the dev server uses}"
app="$(cd "$(dirname "$0")/.." && pwd)"
# The featherbase checkout this app sits in (client-apps/jeyarama/dash), whose dev server serves it.
repo="$(cd "$app/../../.." && pwd)"
q() { PSQLRC=/dev/null psql -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA "$@"; }

stamp=""
if [ "$(echo "select to_regclass('featherbase.internal_metadata') is not null" | q)" = t ]; then
  stamp="$(echo "select value from featherbase.internal_metadata where key = 'environment'" | q)"
fi
# Never print DATABASE_URL: it carries the password.
[ "$stamp" = development ] || { echo "!! this database is stamped '${stamp:-nothing}', not 'development'; refusing" >&2; exit 1; }

server="$repo/apps/server"
outcome="$(cd "$server" && node_modules/.bin/tsx "$app/scripts/platform-loads-app.mts" "$repo" "$app" | tail -1)"
field() { node -e 'process.stdout.write(String(JSON.parse(process.argv[1])[process.argv[2]]))' "$outcome" "$1"; }
[ "$(field accepted)" = true ] || { echo "!! the platform's loader rejects the app folder; run npm test for details" >&2; exit 1; }
version="$(field version)"; digest="$(field digest)"

same="$(echo "select (manifest - 'packageName' - 'packageVersion' - 'migrations') = (:'manifest'::jsonb - 'migrations')
  from featherbase.installed_app where name = 'feather_dash' and package_version = :'version'" |
  q -v manifest="$(cat "$app/featherbase.json")" -v version="$version")"
case "$same" in
  t) ;;
  f) echo "!! featherbase.json differs from the installed manifest; recreate the dev database (README)" >&2; exit 1 ;;
  *) echo "!! feather_dash $version is not installed on this database; install it first (README)" >&2; exit 1 ;;
esac

echo "update featherbase.installed_app set artifact_digest = :'digest'
  where name = 'feather_dash' and package_version = :'version'" | q -v digest="$digest" -v version="$version" >/dev/null
# The dev server (tsx watch) imported dist/server.mjs, so touching it restarts
# the server, whose discovery now finds the folder matching its install.
touch "$app/dist/server.mjs"
echo "feather_dash $version re-pinned to ${digest:0:12}; the dev server restarts and serves it"

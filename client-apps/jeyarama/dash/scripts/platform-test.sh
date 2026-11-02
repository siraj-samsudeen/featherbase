#!/usr/bin/env bash
# Runs platform-test/*.test.ts inside this repository's own server test harness
# (feather-testing-postgres: every test in a rolled-back transaction), so the
# app's Tables, scope provider and report are exercised by the real platform.
#
# The test runner loads server modules only from within apps/server, so the
# tests and the built app are copied into apps/server/test/ for the run and
# removed afterwards. Run `pnpm install` at the repository root and build the
# app (npm run build) first.
#
#   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/<your own test db> \
#   npm run test:platform
#
# DATABASE_URL must name a database of your own: the harness migrates it (run
# `NODE_ENV=test pnpm --filter server migrate` on it once) and empties its job
# queue. Arguments name test files to run (e.g. `npm run test:platform --
# tables.test.ts`); none runs them all.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to a test database of your own}"
app_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$app_dir/../../.." && pwd)"
server="$repo/apps/server"
[[ -f "$app_dir/dist/server.mjs" ]] || { echo "!! build the app first: npm run build" >&2; exit 1; }
coverage_args=()
target="$server/test/feather-dash-platform-$$"
trap 'rm -rf "$target"' EXIT
mkdir -p "$target/app"
cp "$app_dir"/platform-test/*.ts "$app_dir"/platform-test/*.mjs "$target/"
cp -R "$app_dir/package.json" "$app_dir/featherbase.json" "$app_dir/dist" "$target/app/"
if [[ "${DASH_BACKEND_COVERAGE:-}" = 1 ]]; then
  # Instrument canonical modules before bundling, only in the disposable copy.
  node "$app_dir/scripts/build-backend-coverage.mjs" "$target/app/dist/server.mjs"
  coverage_args=(--config "$app_dir/vitest.backend.config.ts")
fi
cd "$server"
FEATHER_DASH_DIR="$target/app" ALLOW_MOCK_OAUTH=1 PSQLRC=/dev/null \
  node_modules/.bin/vitest run "${coverage_args[@]}" $(if (($#)); then for name in "$@"; do echo "test/$(basename "$target")/$name"; done; else echo "test/$(basename "$target")"; fi)

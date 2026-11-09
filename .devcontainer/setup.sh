#!/usr/bin/env bash
# Runs once when the dev container is created.
set -euo pipefail
cd "$(dirname "$0")/.."
sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client
npm install --global corepack@0.36.0
corepack enable
pnpm install
pnpm apps:prepare
# The browser the tours drive (the only browser tests).
pnpm --filter web exec playwright install --with-deps chromium
# The database runs as its own service; the scripts read DATABASE_URL from here.
[ -f .env.local ] || echo "DATABASE_URL=postgres://postgres:postgres@db:5432/featherbase" > .env.local
echo "Ready. Run ./init.sh to boot Featherbase and smoke-test it."

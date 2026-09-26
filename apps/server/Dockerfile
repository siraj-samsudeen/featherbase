# Generic production image for apps/server (#57). Vendor-neutral: it needs
# only DATABASE_URL (and optionally PORT, WEB_ORIGINS, JWT_SECRET, see
# docs/DEPLOY.md). Build from the REPO ROOT so the workspace resolves:
#
#   docker build -f apps/server/Dockerfile -t featherbase-server .
#
# Run the release step once per deploy BEFORE new containers serve traffic:
#
#   docker run --rm -e DATABASE_URL=... featherbase-server pnpm --filter server release
#   docker run -d   -e DATABASE_URL=... -p 8000:8000 featherbase-server
#
# The image also carries the built SPA (apps/web/dist, from the web-build
# stage below); index.ts serves it when the directory exists, so one
# container answers both / and /api on a single origin. See "Single-origin
# deployment" in docs/DEPLOY.md.

# ---- Stage 1: build the SPA -------------------------------------------------
FROM node:22-slim AS web-build
WORKDIR /app
RUN corepack enable
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter web build

# ---- Stage 2: build independently packaged runtime apps --------------------
FROM node:22-slim AS tasker-build
WORKDIR /app/runtime-apps/tasker
COPY runtime-apps/tasker/package.json runtime-apps/tasker/package-lock.json ./
RUN npm ci --ignore-scripts
COPY runtime-apps/tasker/featherbase.json runtime-apps/tasker/index.html runtime-apps/tasker/tsconfig.json runtime-apps/tasker/vite.config.ts ./
COPY runtime-apps/tasker/src src
RUN npm run build

FROM node:22-slim AS feather-dash-build
WORKDIR /app/runtime-apps/feather_dash/0.2.1
COPY runtime-apps/fixtures/feather-dash-v0.2.1/package.json ./
COPY runtime-apps/fixtures/feather-dash-v0.2.1.package-lock.json ./package-lock.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---- Stage 3: the server image ---------------------------------------------
FROM node:22-slim
WORKDIR /app
RUN corepack enable
# Native TLS clients (including the MotherDuck DuckDB extension) use the
# system trust store rather than Node's bundled roots. Keep its CA bundle in
# the final image, not only in the build stage.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# PDF printing resolves Chromium from CHROMIUM_PATH / PLAYWRIGHT_BROWSERS_PATH
# at runtime; never download browsers into the image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter server... --prod

COPY packages/shared packages/shared
COPY apps/server apps/server
COPY --from=web-build /app/apps/web/dist apps/web/dist
# @spec runtime_upgrade_recovery_boundary.packaged_upgrade_retains_exact_predecessor
COPY runtime-apps/fixtures/tasker-v1-production /app/runtime-apps/tasker/0.0.1
COPY --from=tasker-build /app/runtime-apps/tasker/package.json /app/runtime-apps/tasker/2.1.0/package.json
COPY --from=tasker-build /app/runtime-apps/tasker/featherbase.json /app/runtime-apps/tasker/2.1.0/featherbase.json
COPY --from=tasker-build /app/runtime-apps/tasker/dist /app/runtime-apps/tasker/2.1.0/dist
# @spec runtime_upgrade_recovery_boundary.packaged_upgrade_preserves_unrelated_installed_apps
COPY runtime-apps/fixtures/feather-dash-v0.1.3 /app/runtime-apps/feather_dash/0.1.3
COPY runtime-apps/fixtures/feather-dash-v0.2.1 /app/runtime-apps/feather_dash/0.2.1
COPY --from=feather-dash-build /app/runtime-apps/feather_dash/0.2.1/node_modules /app/runtime-apps/feather_dash/0.2.1/node_modules

ENV NODE_ENV=production
ENV FEATHERBASE_APP_PATHS='["/app/runtime-apps/tasker/0.0.1","/app/runtime-apps/tasker/2.1.0","/app/runtime-apps/feather_dash/0.1.3","/app/runtime-apps/feather_dash/0.2.1"]'
ENV FEATHER_DASH_FIXTURE=/app/runtime-apps/feather_dash/0.1.3/fixtures/source.json
ENV FEATHER_DASH_PROVIDER_STATE=/data/apps/feather_dash/fixture-provider.json
ENV FEATHER_DASH_MOTHERDUCK_STATE=/data/apps/feather_dash/motherduck-provider.json
ENV FEATHER_DASH_MOTHERDUCK_PRINCIPAL=motherduck_dive_service_account
RUN pnpm --filter server exec tsx scripts/verify-production-runtime-apps.ts
ENV NODE_OPTIONS="--import=/app/runtime-apps/feather_dash/0.1.3/dist/development-bootstrap.mjs --import=/app/runtime-apps/feather_dash/0.2.1/dist/development-bootstrap.mjs"
EXPOSE 8000
CMD ["pnpm", "--filter", "server", "start"]

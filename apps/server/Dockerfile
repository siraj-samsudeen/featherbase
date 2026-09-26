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
COPY --from=tasker-build /app/runtime-apps/tasker/package.json runtime-apps/tasker/package.json
COPY --from=tasker-build /app/runtime-apps/tasker/featherbase.json runtime-apps/tasker/featherbase.json
COPY --from=tasker-build /app/runtime-apps/tasker/dist runtime-apps/tasker/dist

ENV NODE_ENV=production
ENV FEATHERBASE_APP_PATHS='["/app/runtime-apps/tasker"]'
EXPOSE 8000
CMD ["pnpm", "--filter", "server", "start"]

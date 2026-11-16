# Which image the build ends on (see the last line). A build argument, which
# Railway fills from the service variable of the same name.
ARG FEATHERBASE_INSTANCE=""
ARG FINAL_STAGE=${FEATHERBASE_INSTANCE:+instance-image}

# Generic production image for apps/server (#57). Vendor-neutral: it needs
# only DATABASE_URL (and optionally PORT, WEB_ORIGINS, JWT_SECRET, see
# docs/DEPLOY.md). Build from the REPO ROOT so the workspace resolves:
#
#   docker build -f apps/server/Dockerfile -t featherbase-server .
#
# For a client instance's image, with its apps and its folder (docs/DEPLOY.md):
#
#   docker build -f apps/server/Dockerfile --build-arg FEATHERBASE_INSTANCE=<client>/<instance> -t my-instance .
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
FROM node:26.13.0-slim AS web-build
WORKDIR /app
# Node 26 no longer bundles Corepack; package.json still selects pnpm.
RUN npm install --global corepack@0.36.0 && corepack enable
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches patches
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/shop-floor/package.json packages/shop-floor/
RUN pnpm install --frozen-lockfile --filter web...

COPY packages/shared packages/shared
COPY packages/shop-floor packages/shop-floor
COPY apps/web apps/web
RUN pnpm --filter web build

# ---- Stage 2: build independently packaged runtime apps --------------------
FROM web-build AS tasker-build
WORKDIR /app/example-apps/tasker
COPY example-apps/tasker/package.json example-apps/tasker/package-lock.json ./
RUN npm ci --ignore-scripts
COPY example-apps/tasker/featherbase.json example-apps/tasker/index.html example-apps/tasker/tsconfig.json example-apps/tasker/vite.config.ts ./
COPY example-apps/tasker/src src
COPY example-apps/tasker/public public
COPY example-apps/tasker/scripts/build-server.mjs scripts/build-server.mjs
RUN npm run build

# Tickets (#810) ships beside Tasker in the default image. Shipped is not
# installed: an administrator installs it explicitly (install-app or Apps).
FROM web-build AS tickets-build
WORKDIR /app/example-apps/tickets
COPY example-apps/tickets/package.json example-apps/tickets/package-lock.json ./
RUN npm ci --ignore-scripts
COPY example-apps/tickets/featherbase.json example-apps/tickets/index.html example-apps/tickets/tsconfig.json example-apps/tickets/vite.config.ts ./
COPY example-apps/tickets/src src
COPY example-apps/tickets/scripts/build-server.mjs scripts/build-server.mjs
RUN npm run build

FROM node:26.13.0-slim AS platform
WORKDIR /app
RUN npm install --global corepack@0.36.0 && corepack enable
# Native TLS clients (including the MotherDuck DuckDB extension) use the
# system trust store rather than Node's bundled roots. Keep its CA bundle in
# the final image, not only in the build stage.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# PDF printing resolves Chromium from CHROMIUM_PATH / PLAYWRIGHT_BROWSERS_PATH
# at runtime; never download browsers into the image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches patches
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter server... --prod

COPY packages/shared packages/shared
COPY apps/server apps/server
COPY --from=web-build /app/apps/web/dist apps/web/dist

ENV NODE_ENV=production
EXPOSE 8000
CMD ["pnpm", "--filter", "server", "start"]

# ---- Stage 4: a client instance's apps and folder ---------------------------
# Skipped by every build that doesn't name an instance.
FROM web-build AS instance-build
ARG FEATHERBASE_INSTANCE
WORKDIR /app
COPY client-apps client-apps
COPY example-apps example-apps
COPY tools/dev.mjs tools/build-instance-apps.mjs tools/
RUN node tools/build-instance-apps.mjs "$FEATHERBASE_INSTANCE" /out

# ---- Stage 5: a client instance's image -------------------------------------
FROM platform AS instance-image
ARG FEATHERBASE_INSTANCE
COPY --from=instance-build /out/ ./
ENV FEATHERBASE_INSTANCE=$FEATHERBASE_INSTANCE
ENV FEATHERBASE_APP_PATHS='["/app/instance-apps/*"]'

# ---- Stage 6: this repository's own server image (the default target) ------
# The platform image plus Tasker and Tickets. NODE_ENV, EXPOSE and CMD come
# from the platform stage.
FROM platform AS tasker-image
COPY --from=tasker-build /app/example-apps/tasker/package.json example-apps/tasker/package.json
COPY --from=tasker-build /app/example-apps/tasker/featherbase.json example-apps/tasker/featherbase.json
COPY --from=tasker-build /app/example-apps/tasker/dist example-apps/tasker/dist
COPY --from=tickets-build /app/example-apps/tickets/package.json example-apps/tickets/package.json
COPY --from=tickets-build /app/example-apps/tickets/featherbase.json example-apps/tickets/featherbase.json
COPY --from=tickets-build /app/example-apps/tickets/dist example-apps/tickets/dist

# Only the current versions: an upgrade moves from the installed record (#1178).
ENV FEATHERBASE_APP_PATHS='["/app/example-apps/tasker","/app/example-apps/tickets"]'

# ---- The image this build produces ------------------------------------------
FROM ${FINAL_STAGE:-tasker-image}

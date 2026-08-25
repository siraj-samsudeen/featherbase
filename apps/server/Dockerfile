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

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter web build

# ---- Stage 2: the server image ---------------------------------------------
FROM node:22-slim
WORKDIR /app
# CA certificates (#194). node:22-slim ships none — /etc/ssl/certs does not
# exist — and Node hides that, because its TLS uses a compiled-in trust store.
# Anything else in the image that speaks TLS reads roots from disk instead: the
# MotherDuck extension's statically linked gRPC core is the one that bit us,
# failing with "Could not get default pem root certs" and surfacing it as
# UNAVAILABLE, which reads as a network outage (#113). The driver can fill this
# gap at runtime from Node's roots, but an image that simply has the bundle is
# the honest fix — and it covers every future TLS client, not just DuckDB's.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
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

ENV NODE_ENV=production
EXPOSE 8000
CMD ["pnpm", "--filter", "server", "start"]

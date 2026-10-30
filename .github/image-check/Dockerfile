# A throwaway client image for .github/workflows/image-check.yml (#587): the
# just-built platform image plus the `other` fixture app, shaped like the
# client Dockerfile in docs/DEPLOY.md ("Building a client image"). The
# workflow assembles its build context: this file, discover-check.mts and a
# copy of test-apps/other.
ARG PLATFORM_IMAGE=featherbase-platform:ci
FROM ${PLATFORM_IMAGE}
COPY other /app/client-apps/other-0.0.1
COPY discover-check.mts /app/discover-check.mts
ENV FEATHERBASE_APP_PATHS='["/app/client-apps/other-0.0.1"]'

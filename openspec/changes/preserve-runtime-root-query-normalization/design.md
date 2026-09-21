## Context

Runtime-app middleware canonicalizes an unslashed app root before loading an asset
or checking authentication. The request fragment is unavailable to the server, but
its encoded query is present and must survive this first redirect.

## Goals / Non-Goals

**Goals:** preserve the exact query while adding only the trailing slash.

**Non-Goals:** no fragment handling, login changes, Tasker-specific paths, or
changes to nested app navigation.

## Decisions

Construct the redirect from `appHref(name)` plus `new URL(c.req.url).search`.
This retains the existing shared app-root recognition and canonical destination,
while preserving the URL query bytes exposed by the platform URL parser. Do not
copy the fragment because HTTP requests never contain it.

## Risks / Trade-offs

The query could be accidentally double-encoded if rebuilt parameter-by-parameter.
Appending `url.search` avoids reinterpretation; an asymmetric encoded-query test
distinguishes preservation from rebuilding or dropping it.

## Migration Plan

Ship as a route-only correction. Rollback restores query-dropping normalization;
no persistent state is involved.

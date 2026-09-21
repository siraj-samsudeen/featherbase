## Why

The direct runtime-app root normalizer redirects `/app?query` to `/app/` and
silently discards the query before authentication. That contradicts the governed
exact-location return contract even though the later login handoff is correct.

## What Changes

- Preserve the original encoded query when adding the canonical trailing slash to
  a runtime-app root.
- Prove the generic root behavior for both a bare root and an asymmetric encoded
  query without adding app-specific routing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: The canonical runtime-app root normalization scenario
  explicitly preserves query state before sign-in.

## Impact

Runtime-app navigation middleware and its server route tests only. No data,
package API, authentication, fragment, or Tasker product behavior changes.

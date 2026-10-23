## Why

The production image replaces Tasker's only bundled package directory with the
latest release, so an installed 0.0.1 application becomes unavailable and the
supported reviewed upgrade cannot begin. Issue #308 must make the deployment
artifact satisfy the existing recovery boundary before Featherbase Dev can be
upgraded without resetting retained work.

## What Changes

- Ship the exact reviewed Tasker 0.0.1 predecessor and current Tasker release in
  separate immutable, versioned image directories.
- Match the predecessor's package layout to Dev's recorded declaration
  (`dist/server.mjs` and `dist/client`) so recovery does not rewrite its ledger.
- Configure runtime discovery with both directories so restart selects the exact
  installed version while exposing the newer version for preview.
- Retain exact Feather Dash 0.1.3 and active 0.2.1 artifacts while changing the
  production image's runtime package set.
- Add image-level proof that both artifacts are present with their reviewed
  runtime digests and that the supported preview/upgrade/activation path remains
  data-preserving.
- Correct the deployment runbook's now-obsolete instruction to provision these
  two Tasker artifacts outside the image.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: require a deployment image advertised for an
  installed application upgrade to retain and discover the exact predecessor
  alongside the target rather than replacing the predecessor in place.

## Impact

The production Docker image, its runtime application path configuration, the
retained Feather Dash artifact, deployment documentation, and focused
image/runtime-package tests change. The
runtime APIs, Tasker migrations, database ledger, retained rows, permissions,
settings, and Feather Dash behavior do not change.

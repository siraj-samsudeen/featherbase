## Context

See `proposal.md` for motivation. Runtime discovery fingerprints every file
relative to each configured package root and deliberately requires the exact
installed package before producing an upgrade plan. The final server image
currently copies only the built current Tasker tree to
`/app/runtime-apps/tasker`, while the reviewed 0.0.1 tree remains only in the
source checkout. Railway has no package upload API and the mounted `/data`
volume contains site files rather than repository-reviewed application bytes.

## Goals / Non-Goals

**Goals:**

- Make one built server image self-contained for the supported 0.0.1 → 2.1.0
  Tasker upgrade.
- Keep artifact bytes and runtime digests independent of directory spelling.
- Make a restart before upgrade select 0.0.1 and merely advertise 2.1.0.
- Prove the actual image configuration names both immutable package roots.

**Non-Goals:**

- No package upload or registry mechanism.
- No automatic upgrade, legacy identity adoption, downgrade or down migration.
- No database ledger edits, row changes, seeding, uninstall or Feather Dash
  packaging changes.
- No generic retention policy for an unbounded number of app versions.

## Decisions

### Copy reviewed artifacts into versioned image roots

The final image will contain the existing reviewed v1 fixture at
`/app/runtime-apps/tasker/0.0.1` and the independently built current package at
`/app/runtime-apps/tasker/2.1.0`. `FEATHERBASE_APP_PATHS` will list both exact
roots in ascending version order. Runtime selection remains authoritative: the
ordering does not activate the newer artifact.

This uses the source-controlled artifact already exercised as the exact
predecessor in upgrade tests. Rebuilding or synthesizing v1 was rejected because
any byte or declaration drift would defeat identity recovery. Writing artifacts
to `/data` during deployment was rejected because it creates mutable state
outside the reviewed image and can leave stale bytes across rollback.

### Keep runtime artifact identity unchanged

Only each package root's contents contribute to its SHA-256 identity; parent
directory names do not. The v1 tree is copied verbatim. The current package root
continues to contain exactly its package metadata, manifest and compiled `dist`
tree, so moving it under a version directory does not alter its reviewed digest.

### Add focused deployment-contract proof

A focused asymmetric check will assert both versioned roots and both discovery
entries, distinguishing the required predecessor-plus-target image from the old
target-only image. Existing runtime upgrade tests remain the behavioral proof
for selection, preview, commit, activation and retention. A real Dev deployment
then verifies runtime-computed digests and preserved state; it is evidence, not
a substitute for the repository test.

## Risks / Trade-offs

- **[The Docker image grows by one small historical client/server tree]** → The
  predecessor is intentionally retained recovery material and is bounded to the
  one supported upgrade path.
- **[A future Tasker release could again omit a newly required predecessor]** →
  Keep the focused deployment-contract check version-asymmetric and update the
  explicit retained set through a reviewed change.
- **[Rollback after activation restores an image whose selected app version no
  longer matches the database]** → Use the concrete pre-deploy Railway
  deployment as infrastructure rollback identity only before commit; after
  commit, restore/redeploy the exact 2.1.0 artifact and activate or move forward,
  as the existing recovery contract requires.

## Migration Plan

1. Build and test the image with both artifact roots; record both digests.
2. Back up and read back Dev Tasker rows, permissions and user settings.
3. Deploy the reviewed image to Featherbase Dev and verify 0.0.1 remains the
   installed active version while 2.1.0 is only available.
4. Preview and review the two cumulative migrations, commit the exact plan, then
   activate 2.1.0 explicitly.
5. Restart and read back preserved state, package status and both application
   smoke routes.

Before upgrade commit, rollback can redeploy the prior successful Railway
deployment. After commit, database schema has moved forward, so infrastructure
rollback alone is unsafe; retain/redeploy the reviewed 2.1.0 image and use the
documented forward recovery boundary.

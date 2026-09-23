## Context

See `proposal.md` for motivation. Runtime discovery fingerprints every file
relative to each configured package root and deliberately requires the exact
installed package before producing an upgrade plan. The final server image
currently copies only the built current Tasker tree to
`/app/runtime-apps/tasker`. The generic v1 test fixture uses root-level server
and client paths, but Dev's complete recorded 0.0.1 declaration names
`dist/server.mjs` and `dist/client`; a matching version with a different
declaration correctly remains unavailable. Railway has no package upload API
and the mounted `/data` volume contains site files rather than
repository-reviewed application bytes.

## Goals / Non-Goals

**Goals:**

- Make one built server image self-contained for the supported 0.0.1 → 2.1.0
  Tasker upgrade.
- Keep artifact bytes and runtime digests independent of directory spelling.
- Make a restart before upgrade select 0.0.1 and merely advertise 2.1.0.
- Preserve Feather Dash 0.1.3 and active 0.2.1 packages and runtime wiring.
- Prove the actual image configuration names both immutable package roots.

**Non-Goals:**

- No package upload or registry mechanism.
- No automatic upgrade, legacy identity adoption, downgrade or down migration.
- No database ledger edits, row changes, seeding, uninstall or Feather Dash
  behavior changes.
- No generic retention policy for an unbounded number of app versions.

## Decisions

### Copy reviewed artifacts into versioned image roots

The final image will contain a reviewed production v1 artifact at
`/app/runtime-apps/tasker/0.0.1` and the independently built current package at
`/app/runtime-apps/tasker/2.1.0`. The production predecessor retains the generic
v1 fixture's reviewed server/client bytes and manifest behavior, but places the
files at the `dist/` paths in Dev's recorded complete declaration. Package
metadata names that real layout. `FEATHERBASE_APP_PATHS` will list both exact
roots in ascending version order. Runtime selection remains authoritative: the
ordering does not activate the newer artifact.

Using the generic root-path fixture directly was rejected because its declaration
does not equal Dev's installed declaration; version equality alone is not
identity recovery. Updating the database declaration was rejected because it
would bypass the supported artifact-restoration contract. Writing artifacts to
`/data` during deployment was rejected because it creates mutable state outside
the reviewed image and can leave stale bytes across rollback.

The same image retains exact reviewed Feather Dash packages at
`/app/runtime-apps/feather_dash/0.1.3` and
`/app/runtime-apps/feather_dash/0.2.1`, including fixture and MotherDuck provider
wiring. Omitting the active 0.2.1 package would make Feather Dash unavailable on
the Tasker deployment even though no Feather Dash lifecycle operation was
requested. The 0.1.3 bytes come from Data Warehouse commit
`eb12f18b283617f272a40c125c2baff90cf1ef05`; 0.2.1 comes from
`be97c8578b26b882622eb01f50249121345f2f78`. Both are pinned by runtime digest.

### Keep runtime artifact identity unchanged

Only each package root's contents contribute to its SHA-256 identity; parent
directory names and installed runtime dependencies do not. Every final package
root contains exactly its pinned package metadata, manifest and runtime files.
The Dash 0.2.1 dependency tree is installed from its separately retained lockfile
without changing the package artifact digest.

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
3. Deploy the reviewed image to Featherbase Dev and verify 0.0.1 becomes the
   available active version without a ledger write while 2.1.0 is only available
   and Feather Dash 0.2.1 remains active.
4. Preview and review the two cumulative migrations, commit the exact plan, then
   activate 2.1.0 explicitly.
5. Restart and read back preserved state, package status and both application
   smoke routes.

Before upgrade commit, rollback can redeploy the prior successful Railway
deployment. After commit, database schema has moved forward, so infrastructure
rollback alone is unsafe; retain/redeploy the reviewed 2.1.0 image and use the
documented forward recovery boundary.

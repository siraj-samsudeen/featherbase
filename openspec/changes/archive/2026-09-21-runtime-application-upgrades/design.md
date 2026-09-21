## Context

See proposal.md. `installed_app.manifest` already stores packageVersion but boot never compares it. `appOperation` has a separate lock pool and retains shared admission through post-commit work. `withTransaction` composes metadata operations through savepoints. `updateTable` is too broad for migrations: it rewrites every column and accepts metadata deletion; upgrades must not overwrite site metadata customizations.

## Goals / Non-Goals

**Goals:** additive scalar columns and code-only package upgrades on one server, with honest commit/activation separation.

**Non-Goals:** SQL migrations, changed permissions, dependencies, jobs, table additions, schema rollback, distributed registries, marketplace and Project UI.

## Decisions

1. **Cumulative typed migrations.** Manifest `migrations` contains ordered `{id, fromVersion, toVersion, operations}` entries; operations are strict `{kind: addColumn, table, column}` with optional scalar Text/Data/Int/etc. No defaults, references, required/unique flags or SQL. Final Tables remain the fresh-install contract. Derive the baseline by reversing additions, then replay and compare exact declaration structure. Each step must join its predecessor; installed history must be an exact checksum prefix. Code-only versions still append a step with zero operations, so no implicit skipped version exists.
2. **Artifact identity.** Semver numeric triplets; npm package version is authoritative. Hash deterministic manifest plus shipped files, excluding node_modules/.git. Operator directories must be immutable and retained; validate hashes again before upgrade/activation. Multiple configured versions are indexed, never silently choose newer code for an installed app. Legacy installations match their stored normalized manifest/version before adopting a fingerprint. Trust is still full Node/same-origin, not sandboxing.
3. **One database transaction.** The migration engine only inserts new column metadata and uses explicit persisted physical schema/relation in transactional `ALTER TABLE ADD COLUMN`, without `IF NOT EXISTS`. No mutable search_path and no overwrite of old metadata/grants. Ledger, version, target manifest, previous artifact identity and activation-pending flag commit together. Reject collisions instead of adopting unknown physical columns.
4. **Three operator steps.** Preview is read-only and returns a content digest; Upgrade recomputes under the existing exclusive lifecycle lock and requires the digest. Before commit old hooks remain; immediately after commit they are removed while still holding the lock. Activate revalidates the exact target, clears pending durably and wires it once if enabled. Repeated upgrade/activation is idempotent. Boot sees pending and never activates it automatically. Disabled stays disabled; enabling cannot bypass pending activation.
5. **Stale clients.** Version-aware package requests carry `X-Featherbase-App-Version: <name>@<version>`. Once a package has migrations, HTTP operations accessing owned Tables require matching version; older headerless clients fail with reload guidance. Host-internal operations use the already-admitted scope. New client artifacts read their build version; do not fetch latest version per request, which would let an old client impersonate new code.
6. **Recovery.** Before commit any failure retains old code/data. After commit target schema is authoritative; operator restores the exact target artifact then activates. Prior artifact remains configured and recorded but cannot be auto-reactivated against changed schema. Rollback requires a matched external database backup and prior artifact, outside this API.

## Domain assumptions and risks

- Reviewed artifacts execute arbitrary trusted Node code during import; modules must have no import-time writes. Established by #296 trusted contract, 21-Sep-2026; detected by package review, not sandbox enforcement.
- Single-server lifecycle registry, established by existing lock/registry design, 21-Sep-2026; deployment topology inspection detects violation.
- Operator keeps versioned directories immutable and durable across releases, 21-Sep-2026; fingerprint checks detect changed or absent files. There is no platform package upload/storage service.
- PostgreSQL supports transactional additive DDL, but locks can block on external SQL. This is not zero-downtime schema migration; trusted deployment controls external writers.
- Old generic clients without version headers must reload/use a version-aware client for migrated Tables. Do not silently infer client compatibility from a live catalog.

## Migration plan

Apply one generic core ledger migration through normal release, retain v1 and deliver v2 as a separate immutable directory, configure both, restart core without auto-upgrade, authenticate as manager, preview, review digest, upgrade, activate. See final operator documentation for exact commands. No shared database mutation is authorized in this work.

## Review before implementation

Spec five axes: machine promises separated from the three external assumptions above; all new requirements governed; errors and state transitions observable. State partition: absent → install only; installed active → preview/upgrade; disabled → upgrade remains disabled; committed pending → activate only; missing compatible artifact → unavailable; failed transaction → unchanged prior. Direct tests will bind every new requirement before archive. Existing spec's evaluation-authority paragraph contradicts ADR 0010; correct that stale pointer without changing baseline behavior.

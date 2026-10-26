## Context

See proposal.md. Exact historical release succeeded locally with 88 migrations,
one patch, and a production environment stamp. Current release then failed at
0088 with `relation "featherbase.table_def" does not exist`. Production was not
contacted; its actual ledger is not yet independently inspected.

The qualified SQL adapter rewrites historical unqualified relation operands.
0094 cannot run first: it reads owner_app from 0088, while 0090 needs public
prototype tables and public metadata pointers before moving app storage.

## Goals / Non-Goals

**Goals:** retain immutable migration bytes and existing ordering; make the
supported public-to-featherbase transition retryable and independently testable.

**Non-Goals:** repair arbitrary corrupted ledgers, support pre-0087 engines via
today's TypeScript migrations, change runtime routing, or mutate production.

## Decisions

- For a legacy ledger, require all files before 0088 recorded before any DDL.
  Current TypeScript migrations call today's engine, so running them against
  older public metadata would silently promise unsupported compatibility.
- Execute legacy SQL 0088–0093 through a raw root transaction with transaction-local
  `search_path = public, pg_temp`; execute both body and ledger insert through
  that same raw handle. No process-global qualification switch is introduced.
- Keep 0094 on the existing qualified transaction path. Its explicit sources
  and dynamic move statements preserve object OIDs. Discover the ledger after
  each body inside its transaction so the 0094 record follows the moved ledger.
- Keep the current path for fresh and already-converged databases. A later new
  corrective migration cannot unblock 0088, so the runner is the proper boundary.
- Oracle reviewed this boundary before implementation and confirmed that early
  0094 would break prototype conversion as well as the owner_app prerequisite.

## Risks / Trade-offs

- Actual production may differ from a clean historical release → inspect its
  ledger and take a backup under a separately authorized operational step.
- New release is not compatible with old serving code after objects move →
  quiesce old traffic/workers during migration; do not roll back only code.
- Fresh-only tests missed this defect → commit a reproducible exact-old-release
  regression path, asymmetric preservation assertions, and rollback/retry cases.
- Restricting older legacy upgrades is a compatibility boundary → fail before
  mutation with an actionable diagnostic rather than partial current-engine DDL.

## Migration Plan

First complete local fresh/upgrade/retry proof and independent final review.
For a separately authorized deployment, back up database and uploads, inspect
ledger/environment, quiesce old code, run corrected release once, then start new
code and verify login/package availability. Restore database plus matching old
code together if recovery is needed; there is no down migration.

A clean database would bypass the defective legacy branch but would hide rather
than fix the upgrade defect. Reset removes users/passwords, roles/grants, tokens,
metadata, app installations/rows, settings, jobs, history and database-backed
file references; filesystem uploads require a separate retention decision.
The owner's no-real-data report makes reset potentially acceptable, not proof
that there are no useful credentials/configuration to preserve.

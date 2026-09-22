## MODIFIED Requirements

### Requirement: platform_storage_is_explicit
Legacy ID: PKG-R5 · `shape: migration invariant`
Status: governed (#296)
Featherbase-owned relations and functions SHALL live in PostgreSQL schema
`featherbase`. A fresh install SHALL create them there. An upgrade SHALL move
existing objects without replacing their identities, rows, constraints, indexes,
grants, RLS policies, references or migration history. Core logical identities
SHALL remain compatible and unqualified; application logical and physical
identities SHALL remain scoped. Runtime and migration paths SHALL resolve physical
relations deterministically without pooled mutable `search_path` routing.
Security-definer functions SHALL restrict name resolution and explicitly address
their dependencies.

`public.site` SHALL remain an explicitly named pre-tenant host registry. It SHALL
NOT be treated as tenant data or moved into the core schema. Site data SHALL remain
isolated in its selected site schema.

Legacy databases SHALL have all migrations through `0087_dataset_snapshot_tables.ts`
recorded before upgrading directly with the current release. Older or incomplete
legacy ledgers SHALL be rejected before migration mutation, naming the missing
migrations and requiring an intermediate historical upgrade. Supported legacy
upgrades SHALL apply pending prerequisites in order before convergence. Every
migration's effects and ledger entry SHALL commit together; retries SHALL skip
committed prerequisites and resume the first pending migration.

#### Scenario: fresh_and_upgrade_converge_to_same_shape
- **WHEN** a fresh database and an asymmetric exact pre-convergence database run
  the production migration command
- **THEN** both expose the same Featherbase-owned object shape, preserve expected
  upgrade rows and privileges, retain scoped app storage, and leave only the site
  registry at `public.site`.

#### Scenario: failed_convergence_retries_atomically
- **WHEN** convergence is forced to fail before commit and then rerun
- **THEN** the failed attempt moves no partial object set and the retry produces
  exactly one complete migrated state without duplicated rows or grants.

#### Scenario: production_era_prerequisites_precede_convergence
- **WHEN** a database released by commit 3a6770ff651a308bfae0e31b5c525705c356a5a5
  with all migrations through 0087 recorded runs the current release command
- **THEN** pending runtime-storage prerequisites and schema convergence complete,
  preserving existing object identities, rows, grants and ledger timestamps
- **AND** rerunning release makes no duplicate history or grant contributions.

#### Scenario: failed_legacy_prerequisite_retries_atomically
- **WHEN** a pending legacy prerequisite fails after beginning its changes
- **THEN** neither its changes nor its ledger entry survive
- **AND** retry applies it once while retaining earlier committed prerequisites.

#### Scenario: unsupported_legacy_ledger_rejected
- **WHEN** a legacy database lacks any migration recorded by the supported 0087 floor
- **THEN** release names the missing migrations and required intermediate upgrade
  without applying migrations or creating destination storage.

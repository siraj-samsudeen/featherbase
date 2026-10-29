## REMOVED Requirements

### Requirement: platform_storage_is_explicit

**Reason**: Half of it promised how databases from before the platform had its
own schema are upgraded. No instance can take that path any more: a new one
starts from the starting point, and an older one is upgraded first by the last
release before it (#692). The rest is restated, unchanged, as "Platform storage
is explicit".
**Migration**: None.

## ADDED Requirements

### Requirement: Platform storage is explicit
Featherbase-owned relations and functions SHALL live in PostgreSQL schema
`featherbase`. A fresh install SHALL create them there. Core logical identities
SHALL remain compatible and unqualified; application logical and physical
identities SHALL remain scoped. Runtime and migration paths SHALL resolve physical
relations deterministically without pooled mutable `search_path` routing.
Security-definer functions SHALL restrict name resolution and explicitly address
their dependencies.

`public.site` SHALL remain an explicitly named pre-tenant host registry. It SHALL
NOT be treated as tenant data or moved into the core schema. Site data SHALL remain
isolated in its selected site schema.

#### Scenario: A fresh install uses the platform schema
- **WHEN** a fresh database runs the production migration command
- **THEN** every Featherbase-owned object is in the platform schema, and only the
  site registry is at `public.site`

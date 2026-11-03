## Context

Option B accepted by manager under owner30min/no-routine-design at 2026-11-03 07:18 UTC. The current allowlist is exact string equality; default_schema filters introspection, with a DuckDB catalog-only value potentially spanning schemas. PostgreSQL reflection request shorthand is separate from allowlist authority.

## Goals / Non-Goals

Catch incomplete saved restrictions and give old rows useful refusal guidance. No reinterpretation, migration, driver changes, new engine, selected-database changes, or metadata-concealment promise. #772 owns MotherDuck connections and its separate selected-database list; #796 owns connection naming/defaults.

## Decisions

### Preserve explicit authority rather than infer defaults

Keep exact allowlist inclusion as the only authorization check. Validate the entries through the existing Data Source save hook using the same comma/newline parsing as reads. Postgres/MySQL require namespace plus relation; DuckDB requires catalog plus schema plus relation. CSV paths are literal names, not dotted SQL identities. Guidance describes the engine format rather than inventing a default.

Rejected: prefix bare entries using default_schema, a search path, URL database, first match or any-schema suffix. These choices would activate previously ineffective entries and changing defaults could retarget access. No automatic rewrite or filtering is permitted, particularly filtering invalid entries into an empty/unrestricted list.

### Guide existing refusals without invalidating working grants

On denied exact matching only, include qualification guidance if the stored list contains incomplete SQL entries. Do not reject source loading wholesale: a valid qualified entry in an old mixed list must still work. Saving any list containing an incomplete entry is refused atomically; correcting it is an explicit administrator change. Empty-list behavior is unchanged.

## Risks / Trade-offs

- Correcting an existing malformed source requires editing its list on its next save; show field guidance rather than migrate silently.
- Qualification checks do not prove a relation exists or authorize it; exact runtime matching remains necessary. This is not a new SQL identifier grammar or quoted-name parser.
- MotherDuck in #805 is not on this branch. Coordinate the shared hook/registry insertion with its worker; do not import its engine or selected-database code. The same catalog.schema.table guidance applies to its engine when integrated.

## Migration Plan

No data/schema migration. Existing stored strings are untouched. Rollback restores previous validation/error text without rewriting data.

## Open Questions

None within approved option B. Ordinary review and owner merge remain gates; adversarial review not authorized.

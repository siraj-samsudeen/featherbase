## Context

Reproduced on origin/main c49ab37e: creating SAP Plant with module Custom and requesting its row title returns Custom; the real desktop form reads Table: Custom. Table has no title column and module is its first readable value. Its physical natural key is name, serialized as row_id.

## Goals / Non-Goals

Provide a trustworthy Table heading and storage identity without changing any storage or permissions. Do not integrate CDC, copy environment registration files, add credentials, redesign the generic form, or absorb #795 and #792–796.

## Decisions

1. Migrate only Table's unset default title column to name. Preserve nonempty authored defaults and effective Metadata Overrides. The title endpoint must recognize the physical key as readable whenever its public row_id is readable, because name is not a Table column definition. Reject changing the shared row-value fallback: it deliberately avoids internal IDs and applies far beyond this issue. Shared fallback and ordinary generated row titles remain unchanged.
2. Extend the existing permission-checked metadata response with server-resolved storage identity; the generic form loads the described Table's metadata for saved Table definitions. Reuse tableRelation and physicalRowKey for local collections, source binding names for connected Tables, and featherbase.single_value with composite key table_name/field and the Table discriminator for Settings. Reject frontend name conversion: app-owned, reserved-name and connected mappings are not inferable from labels. Do not expose source URLs or credentials.
3. Warehouse destination is absent: the platform has no authoritative configured mapping. Reject inferring a mirror from a Data Source or importing environment-specific warehouse registrations. This preserves the issue's conditional requirement without inventing an integration.

UI details and the reference mockup live in issue #860's numbered checklist. Existing ADRs 0006, 0007 (as amended by app ownership in 0014), 0009, 0011, 0013–0015 and 0017 apply; no architecture is replaced.

## Risks / Trade-offs

- A caller may read a definition but lack permission to read the described Table's metadata → do not expose storage when that metadata request is refused; retain normal form usability.
- Shared Settings storage is not a per-Table relation → show its composite key and Table discriminator explicitly.
- The generated mockup retains an incorrect Custom breadcrumb → implementation and verification must fix both breadcrumb and heading via the shared title path.

## Migration Plan

A forward metadata-only migration updates Table's unset title default, without rewriting the baseline or changing physical storage. Coordinate its numeric ID with the manager before allocation. No production writes or deployment are authorized.

## Open Questions

None. Manager approved narrow scope and no CDC integration on 03-Nov-2026. Rating yellow is proposed, not applied.

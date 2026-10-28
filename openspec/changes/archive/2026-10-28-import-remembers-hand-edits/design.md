## Context
The importer saves through the normal lifecycle and logs touched rows. Versions hold actual changed fields; the import log can retain incoming mapped values as source history. The ten requirements in #626 are the authority.

## Goals / Non-Goals
Protect corrections for tracked Tables across wizard and API. Do not add per-row edited-field flags or client-specific behavior.

## Decisions
- A metadata-generated system-written Import Conflict Table stores conflict evidence. Dedicated actions apply the parent row and column permission rules.
- Each import row runs under its row lock in one transaction with its lifecycle save, version attribution and conflict creation. Protected source history retains incoming mapped values, including unchanged inserts.
- The latest change per field determines authorship. Resolution records the person and decision in history; adopting a source makes that field import-owned. Keeping a value remains person-owned while remembering the incoming value.
- Preview uses the same decision helper without writes. Undo closes the run's conflicts and restores only changed version fields.
- UI uses existing Shop Floor components: per-Table conflict list, Keep mine/Take the source actions, preview counts and warning for no history.

## Risks / Trade-offs
Old imports lack supplied-value snapshots: actual version history is still honored, while no prior source is invented. Locking serializes concurrent imports and resolution. Existing field and row authorization must be applied before returning conflict evidence.

## Migration Plan
Claim migration0139 on #566 before creating the system Table. No user data rewrite. Rehearse locally; archive change in PR.

## Open Questions
None; owner-approved issue checklist supplies behavior and labels.

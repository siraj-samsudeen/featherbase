# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. Keyboard selection is a local interaction correction with no new architectural commitment. The conditional design document is omitted: no new boundary, dependency, data model, migration or security policy is introduced. The manager approved plain arrows and preserving native modified-arrow behavior; macOS Cmd+Arrow is not claimed fixed or verified.

## In-Force ADRs Reviewed

- ADRs 0005–0007 and 0009: naming, React stack, database topology and row identity remain unchanged.
- ADRs 0010–0014 with the partial supersessions in 0015–0017 applied: specification workflow, platform/app boundaries and test quality remain unchanged.
- ADR 0015 preserves accepted ADRs and supersedes the earlier editable-ADR and schema choices.
- ADR 0017 replaces immediate backend coverage thresholds with non-regression baselines; no coverage policy changes here.

Highest sequence reviewed: 0017. ADR 0006's superseded 0001–0004 are historical context.

## New Durable ADRs Created

None. No major durable architectural decisions were introduced and no new repository-level ADR files were created.

## Context

See proposal.md. Existing behavior is separately characterized; the generic editor already has a core-forms capability. Baseline checks: 18 source unit tests and 7 browser journeys passed, alongside strict OpenSpec/STC checks.

## Goals / Non-Goals

**Goals:** Change the six visible behaviors through existing web components and narrowly shared preference/token logic.

**Non-Goals:** No server mutation changes, schema migrations, broad form redesign, full-app accessibility audit or import workflow consolidation.

## Decisions

- Prefer self-describing result text plus small category headings; preserve the existing search handlers. The collision test exposed implicit submission through a record button, so mark record buttons non-submit to honor the existing Table-first handler.
- Serialize each preference's writes, retaining latest intent and last confirmation separately. Ignoring response order alone cannot protect server persistence. Ignore abandoned-session completions.
- Introduce text-role tokens distinct from accent tokens, retaining the existing primary-button ink token. Map existing text utilities to these foreground roles centrally rather than sweep 37 component files; borders, fills, focus rings and charts retain their accent tokens. Verify computed role pairs and utility cascade rather than a snapshot of hexes.
- Keep parsed sheet names for the warning; leave parsing and row import semantics alone.
- Derive prospective Reference proposals from selected eligible candidates in SourceBrowser. Introspection supplies the effective existing `reference_table` using the server's earliest-binding and exact-key rule. A web-only binding query was rejected after executable verification: the list API cannot order by both timestamp and name, and browser timestamps lose database precision. The additive response field avoids duplicating imperfect ordering in the client; no reflection write path changes. Expose conditional/unresolved edges explicitly.
- Use React instance IDs for generated controls, labels and child-grid namespaces. Persisted row IDs and grid-local weakly held draft identities supply both React keys and control IDs; immutable cell edits transfer draft identity without adding metadata to saved row data. Position belongs only in accessible names. Associate the native attachment input with its label and give the visible keyboard-operable action an action-and-field name; a hidden input alone is not an accessible upload action.

## Risks / Trade-offs

- A request may fail after a server committed it (transport ambiguity) → rollback means last acknowledged value, not a claim that a lost response reverted server state.
- Source schema/bindings can change after a preview → preview is a proposal at load time; reflection remains the server authority.
- Contrast changes can subtly affect palettes → preserve accent colors, test all eight combinations and inspect representative rendered pages.
- Independent final review and exploratory handoff are delegated to the parent coordinator, not performed by the implementation author.

# ADR 0015: ADRs are never edited; the process comes from the shared template

**Status:** Accepted · **Date:** 2026-10-31 · **Supersedes:** [ADR 0014](0014-one-repo-for-platform-and-apps.md) § "ADRs are no longer append-only" and its OpenSpec schema line; [ADR 0010](0010-openspec-change-workflow.md)'s choice of schema · **Issue:** [#753](https://github.com/siraj-samsudeen/featherbase/issues/753) · **Template:** siraj-samsudeen/intent-driven-with-human-control#2

## Context

ADR 0014 made ADRs editable: an ADR that stopped matching the code was
corrected in place with a dated note, and deleted once its content lived
somewhere better. It also had OpenSpec run on the owner's own schema,
`intent-driven-with-human-control`, which ADR 0010 adopted.

On 31-Oct-2026 featherbase's process moved into a shared template,
siraj-samsudeen/intent-driven-with-human-control, which every project takes
through Copier. The template uses upstream's `intent-driven` schema unchanged,
so upstream's updates can be pulled. That schema has a rule of its own: ADRs
live in a top-level `adr/` folder and are never edited once accepted. A
project that patches the schema to keep its own rule has to patch it again on
every update.

## Decision

1. **An accepted ADR is never edited.** Not its status, body or date. A
   changed decision is a new ADR whose `Supersedes:` names the old one and
   says which part it replaces. To find what is in force, read the newest ADR
   on a subject and follow its `Supersedes:` chain.
2. **ADRs live in `adr/`** at the repository root, beside `openspec/`.
3. **The process comes from the template.** Skills, the OpenSpec schema and
   `openspec/config.yaml` arrive through `copier update`, with featherbase's
   values in `.copier-answers.yml`. A process change is made in the template
   and pulled here. New changes use upstream's `intent-driven` schema, and the
   mode a change is built in stays session state, as before.
4. **One worktree per issue.** Each issue is built in its own worktree, on
   branch `issue-<n>-<change-name>`, with its own `.env` (database and ports).
   The manager session stays on `main`. This replaces the earlier rule of a
   plain branch in the main checkout, with worktrees only for real parallel
   work.

The rest of ADR 0014 stands.

## Consequences

- An ADR can be out of date, and that's expected. A reader sees which newer
  ADR supersedes it, so the history of a decision is kept in the ADRs.
- ADRs 0010, 0011, 0013 and 0014 keep their dated corrections from before
  today, so nothing is rewritten after the fact.
- Featherbase carries no schema patch, so an upstream schema update applies
  cleanly.
- Several sessions can work at once without sharing a database or ports.

## Options considered

| Option | Why not |
|---|---|
| Keep editing ADRs in place, by patching the template's schema text here | Every `copier update` would have to re-apply the patch, and featherbase would follow a different ADR rule from every other project |
| Delete ADRs when their content lives elsewhere | Same problem as editing, and the reasons for a decision go with the deleted ADR |

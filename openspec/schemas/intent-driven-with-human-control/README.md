# Intent-Driven With Human Control — OpenSpec Schema

A fork of the `intent-driven` schema below. Two differences, both in the build phase:

- `tasks.md` is the **test list**: one group per scenario, the outer acceptance test first, then
  the inner tests the design needs. No setup tasks — setup arrives with the test that needs it.
- `apply` stops **once per test**, for the human's prediction; every red, green and refactor is
  its own commit (the `outside-in-tdd` skill).

Everything else — proposal, specs, design, adr — is the upstream schema unchanged.

This schema serves all three of the fork's modes, **autopilot**, **build** and **learning**. The
mode is chosen in the session and never recorded in the change, so switching it changes no file
(corrected 31-Oct-2026, #738: autopilot used to mean the upstream `intent-driven` schema, and a
`**Mode:**` line recorded the mode). It is the default schema in `openspec/config.yaml`. See the
`change-modes` skill.

---

# Intent-Driven OpenSpec Schema (upstream text)

`intent-driven` is a proposal-to-tasks workflow for changes where contributor
intent, observable behaviour, technical design, and durable architectural
decisions should all be captured before implementation.

It keeps specs mergeable by default OpenSpec archive by generating
`specs/<capability>/spec.md` files. The Markdown headings are the OpenSpec
wrapper; the content inside each requirement and scenario should be written in
Gherkin style with `GIVEN`, `WHEN`, and `THEN` steps.

- Good fit: product or platform changes with meaningful behaviour and
  long-lived design decisions, cross-module work, or architecture choices that
  future changes should honor.
- Not a good fit: small tactical fixes, docs-only changes, dependency bumps, or
  behaviour-only work where `behaviour-driven` is enough.

## Activate

Set this in `openspec/config.yaml`:

```yaml
schema: intent-driven-with-human-control
```

## Stage Gates

Artifact order:

```text
proposal -> specs -> design -> adr -> tasks
```

Gate expectations:

- `proposal` states why the change matters and lists the capabilities that need
  behaviour specs.
- `specs` creates one OpenSpec Markdown delta file per capability at
  `specs/<capability>/spec.md`.
- `design` explains the implementation approach and accounts for currently
  in-force ADRs.
- `adr` writes the per-change ADR review manifest at
  `openspec/changes/<change>/adr.md` after design and before task planning.
  Durable repository-level ADR files are created only when the change
  introduces a major architectural decision that should persist beyond the
  change.
- `tasks` are planned only after proposal, specs, design, and ADR artifacts are
  complete.

## Spec Format

Use OpenSpec Markdown delta headers so archive can merge the change:

```md
## ADDED Requirements

### Requirement: User data export
Feature: User data export

Rule: Users can export their own data

#### Scenario: Successful CSV export
- **GIVEN** a user has saved data
- **WHEN** the user exports their data as CSV
- **THEN** the system provides a CSV file containing the user's data
```

Do not create `.feature` files for this schema. External Gherkin linting can be
run by the target project, but the schema package intentionally does not include
Gherkin lint configuration.

## ADR Persistence

The `adr` artifact completion signal is the change-local review manifest at
`openspec/changes/<change>/adr.md`. Existing files under the repository-level
`docs/adr/` folder are context for a new change; they are not completion evidence
for that change.

Durable ADR files are generated under the repository's `docs/adr/`
folder only when the change introduces a major architectural decision that
should persist beyond the change. They are not written inside the OpenSpec
change folder. ADRs here are not append-only (ADR 0014): an ADR that stops
matching the code is corrected in place with a dated note, and a replaced
decision gets a new superseding ADR plus a dated note on the old one.

## Validate

```bash
openspec schema validate intent-driven-with-human-control
```

For more schemas, refer to https://github.com/intent-driven-dev/openspec-schemas.

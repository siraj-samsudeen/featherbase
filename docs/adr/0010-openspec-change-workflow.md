# ADR 0010: OpenSpec is the behavior contract and change workflow

**Status:** Accepted · **Date:** 2026-09-21, revised 2026-09-26 · **Issue:** [#296](https://github.com/siraj-samsudeen/featherbase/issues/296)

> **2026-09-26 note:** this revises the 2026-09-21 decision in place rather than
> superseding it with a new ADR — the owner's explicit choice, since the
> destination (OpenSpec as sole behavior contract) is unchanged and only the
> shape of the tooling around it moved. The original text remains in git
> history. What changed: the project now runs stock upstream OpenSpec (the
> `core` profile) instead of a locally customized layer, and the STC
> traceability apparatus (`@spec` markers, the STC matrix, the spec-policy
> check, mandatory status/evidence labels in spec prose) is retired in favor of
> plain strict OpenSpec validation.

## Context

Featherbase evaluated OpenSpec beside its local Journey specification form by
migrating one capability and measuring what each format preserved. That trial
left two active-looking behavior roots, two traceability mechanisms, and a CLI
supplied by the developer's global environment. A fresh contributor therefore
could not tell which contract governed behavior or reproduce the workflow from
the repository alone.

The ambiguity is most dangerous for existing features. Reverse-engineering
shipped behavior and deciding how it should change are different acts. When
they share one document edit or commit, a characterization mistake is
indistinguishable from an intentional product decision.

## Decision

OpenSpec is Featherbase's sole behavior specification and mandatory change
workflow, run as plain, stock upstream OpenSpec.

- New behavior begins as an OpenSpec change before implementation.
- A spec written for existing behavior describes what it does today. Changing
  that behavior is a separate OpenSpec change, so a reviewer can tell a
  description from a decision. This is a writing rule (in
  `openspec/config.yaml`), not a tooling-enforced commit ceremony.
- Design, ADR, and research documents may retain alternatives and rationale,
  but do not form a second behavior contract.
- **Stock core profile.** The repository runs the CLI's `core` profile
  (propose, explore, apply, archive, sync, update) with no repository-specific
  workflows, skills, or commands layered on top.
- **Exact pin, automated bump.** The OpenSpec CLI is exactly pinned in root
  `package.json`. A weekly scheduled workflow checks for a newer published
  version, and when one exists it bumps the pin, regenerates the core-profile
  files, and opens a PR — so the pin moves on a schedule instead of by hand.
- **Plain-language, non-brittle spec style.** Spec and proposal writing rules
  live in `openspec/config.yaml`'s `rules:` block: write for a product person,
  plain words, no code/table/column/endpoint/file/function names, one
  requirement per user-facing promise. This replaces a denser, code-adjacent
  style that assumed a programmer reader.
- **No local traceability apparatus.** There are no `@spec` code markers, no
  STC matrix, no spec-policy check, no mandatory baseline-first commit
  enforced by tooling, and no `Status:` / evidence / legacy-ID labels inside
  spec requirement text. `openspec validate --strict` is the only mechanical
  gate; whether code and tests agree with a spec is checked in ordinary
  code review, not by a CI-enforced marker convention.
- **Journey specs were transitional.** The Journey documents under `docs/specs/`
  were migration evidence, not a governed contract. Each was converted into an
  OpenSpec capability and then deleted from `docs/specs/` on 2026-09-26; there
  was no standing requirement to keep both forms in sync while the migration
  was in progress.

## Why

**One source of truth** removes reconciliation between equally authoritative
documents. **Describe before changing** separates “what exists” from “what should
change,” so each can be reviewed on its own evidence. **Delta changes** make
behavior modifications explicit and archive them into the capability contract
instead of rewriting history invisibly. **Explicit upgrades** keep the CLI,
artifact schema, generated agent workflows, local checkout, and CI on one
version.

## Consequences

`openspec/specs/` is the only active behavior root. The pre-adoption Journey
documents carried no authority and could not grow; each was converted into a
capability and, once all of them were accounted for, the whole `docs/specs/`
directory was deleted on 2026-09-26.

OpenSpec strict validation is necessary but not sufficient: it proves artifact
shape, not agreement with implementation. Whether code and tests agree with a spec is
now checked in ordinary code review, not by a CI-enforced marker convention — the tradeoff is less mechanical
ratcheting in exchange for a spec vocabulary that a product person, not only a
programmer, can read and own.

Contributors get plain upstream OpenSpec: the generated skills and commands
match what `openspec init --profile core` produces for any project, so
onboarding and troubleshooting can use OpenSpec's own docs directly rather
than a repository-specific variant. The exact pin plus the weekly automated
update PR keep that parity current without requiring a human to remember to
bump it.

The evaluation's useful findings survive as history and in the local review
skills. Its recommendation against migration is superseded by this decision.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep Journey specs as the authority and use OpenSpec only for change planning | A delta that archives into a non-authoritative mirror recreates two facts and makes drift inevitable. |
| Allow either format per feature | Contributors must rediscover the governing workflow for every change, and cross-feature review cannot rely on one validation path. |
| Convert legacy behavior while changing it | Review cannot distinguish inaccurate recovery from deliberate modification; defects can be laundered into the baseline. |
| Use whichever OpenSpec version is globally installed or latest on the registry | The workflow and generated instructions can change without a repository diff or CI parity. |

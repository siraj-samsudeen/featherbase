# ADR 0010: OpenSpec is the behavior contract and change workflow

**Status:** Accepted · **Date:** 2026-09-21 · **Issue:** [#296](https://github.com/siraj-samsudeen/featherbase/issues/296)

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
workflow.

- New behavior begins as an OpenSpec change before implementation.
- Existing behavior without an OpenSpec capability is first recovered as a
  verified baseline and committed without behavior changes. A later OpenSpec
  delta and implementation commit make the intended change.
- Code and asymmetric tests trace directly to descriptive OpenSpec requirement
  or scenario slugs.
- Design, ADR, and research documents may retain alternatives and rationale,
  but do not form a second behavior contract.
- The OpenSpec CLI is exactly pinned. Upgrades deliberately change that pin and
  refresh generated workflow files together.

## Why

**One source of truth** removes reconciliation between equally authoritative
documents. **Baseline first** separates “what exists” from “what should
change,” so each can be reviewed on its own evidence. **Delta changes** make
behavior modifications explicit and archive them into the capability contract
instead of rewriting history invisibly. **Explicit upgrades** keep the CLI,
artifact schema, generated agent workflows, local checkout, and CI on one
version.

## Consequences

`openspec/specs/` is the only active behavior root. Pre-adoption Journey
documents may remain temporarily as frozen migration evidence but carry no
authority and cannot grow. They leave as capabilities are baselined or retired.

OpenSpec strict validation is necessary but not sufficient: it proves artifact
shape, not agreement with implementation. STC linkage and semantic review
remain separate checks.

The evaluation's useful findings survive as history and in the local review
skills. Its recommendation against migration is superseded by this decision.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep Journey specs as the authority and use OpenSpec only for change planning | A delta that archives into a non-authoritative mirror recreates two facts and makes drift inevitable. |
| Allow either format per feature | Contributors must rediscover the governing workflow for every change, and cross-feature review cannot rely on one validation path. |
| Convert legacy behavior while changing it | Review cannot distinguish inaccurate recovery from deliberate modification; defects can be laundered into the baseline. |
| Use whichever OpenSpec version is globally installed or latest on the registry | The workflow and generated instructions can change without a repository diff or CI parity. |

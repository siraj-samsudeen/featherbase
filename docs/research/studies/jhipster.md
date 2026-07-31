# JHipster — model-to-everything generation, tests included

> Study, 2026-07-26. Family: **code generator**. Personal note: a project
> the author loves and half-wanted to redo — "once you sign up, the whole
> E2E test and everything is there, just that it looks very complicated."
> Both halves of that sentence are architectural, not accidental.

## What it is

An opinionated full-stack generator: describe applications, entities,
relationships, and even deployments in **JDL** (JHipster Domain Language,
a compact text DSL), and it generates a complete Spring Boot backend +
Angular/React/Vue frontend — JPA entities, repositories, services, REST
resources, forms, list pages, validation on both sides, auth, i18n,
Docker/Kubernetes descriptors, CI pipelines, and the **entire test
pyramid**: unit tests, integration tests, Cypress e2e, Gatling load tests.

## Key dimensions

1. **The model is a text artifact (JDL), not a UI session.** One file
   declares entities, fields with validation rules, relationships, enums,
   and per-entity options (pagination, DTO, service layer, filtering).
   Diffable, reviewable, generatable-by-tooling.
2. **Generate everything, then hand over ownership.** The output is a
   normal codebase; JHipster has no runtime presence at all. Refactor
   freely — it's your code.
3. **The test pyramid is part of the deliverable.** Every generated
   entity arrives with tests at every layer. Quality isn't something you
   add to the scaffold; it ships in it.
4. **Blueprints: the generator itself is extensible.** A blueprint is a
   Yeoman generator that overrides templates and sub-generators —
   community blueprints swap whole stacks (Quarkus, Micronaut, .NET,
   Node). Extension happens at *generation time*, the analog of runtime
   plugins one level up.
5. **Upgrade by three-way merge.** `jhipster upgrade` regenerates the app
   clean on a branch and git-merges it into yours — the most honest
   mechanical answer anyone has given to the round-trip problem.

## What it enables

- A production-grade, *tested* application in an afternoon — the exact
  experience the author wants to recreate.
- Zero lock-in: teams delete JHipster from their toolchain and keep
  shipping, because nothing at runtime depends on it.
- Stack evolution without re-modeling: the same JDL regenerates onto a
  different blueprint.

## Downsides

- **The complexity wall is structural.** Generating *everything* means
  the day-one codebase carries every concern of a mature app (security
  config, caching, websockets, CI, deployment) — hundreds of files the
  new owner must eventually understand. "It looks very complicated"
  because it *is* the whole app, honestly disclosed up front.
- **The round-trip problem, only mitigated.** Once entities are
  customized, regenerating from changed JDL or upgrading versions turns
  into real merge conflicts. The model silently stops being the truth the
  first week someone edits a generated service.
- **No runtime metadata.** An end user or admin can never add a field —
  every model change is a developer + regeneration + deployment cycle.
  This alone rules it out as Featherbase's core, whose whole premise is
  runtime DocTypes.
- Option-matrix sprawl: N frontends × M backends × K options is a heavy
  test/maintenance burden the project itself carries.

## What Featherbase should adopt

- **The deliverable standard (adopt hardest):** an entity is not "done"
  when the table exists — it's done when its list/form work *and its
  tests, seeds, and e2e checks exist*. For generated *and adopted*
  DocTypes, emitting test skeletons + seed fixtures should be part of the
  engine's output. This matches the repo's harness culture already.
- **A JDL-like text DSL as an authoring input** for DocTypes — alongside
  the UI and reflection, not instead of them. Compact, diffable,
  agent-friendly (Axis G); it compiles to the same DocType JSON
  (ADR 0003's canonical artifact).
- **Blueprints ≈ D11 at generation level:** when Featherbase emits
  derived artifacts (D19), the emitters should themselves be contribution
  points, so a package can override how types/stubs/tests are generated.
- **The eject off-ramp (D19):** JHipster's ownership model becomes
  Featherbase's escape hatch — a DocType can be ejected to owned code
  when a client outgrows metadata, one-way, eyes open.

**Do not adopt:** generation as the primary mode (kills runtime
authoring, invites round-trip drift); the everything-up-front deliverable
(Featherbase's generic Desk means most apps never need the generated-app
surface at all).

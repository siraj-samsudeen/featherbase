# The generator family — ScaffoldHub, Rails admin panels, and the XML→EJB era

> Study, 2026-07-26. Family: **code generators** (with one honorary
> interpreter). Grouped because together they map every known answer to
> the round-trip problem. Includes the author's own formative system: an
> MDM platform built ~20 years ago from an **XML model definition**
> generating EJB backends and front+back validation — "still what I want
> to get back in the modern days: simple where it is possible, and the
> code can always be refactored."

## The systems

### ScaffoldHub

Commercial generator: design the data model on a visual canvas (entities,
fields, relations), and it generates a full multi-tenant SaaS codebase —
Next.js/Prisma (earlier versions: several stacks), forms, lists,
validation, RBAC, audit logs, i18n, tests. **You own the code forever**;
customization happens in your editor. Regeneration is effectively a
starting-point story, not a lifecycle: it optimizes for the first month,
not year three.

### Rails: scaffolding, ActiveAdmin, Administrate

Three answers from one ecosystem:

- **`rails generate scaffold`** — one-shot generation of
  model/controller/views; universally used as a *learning and starting*
  device, universally abandoned as a lifecycle tool. Rails' real lesson
  is **convention over configuration**: most metadata is *implied*, so
  there is less model to keep in sync.
- **ActiveAdmin** — the honorary interpreter: a runtime admin framework
  configured by a Ruby **DSL** per resource. No generated code to drift —
  but the DSL is its own world; when you outgrow it, you fight it.
- **Administrate** (thoughtbot) — the philosophical opposite, and the one
  whose principle sounds like the author's own words: **"no DSLs; support
  the simplest use cases and let the user override defaults with standard
  tools"** — plain Rails controllers and views, ordinary classes and
  inheritance. Simple where possible; escape by writing normal code, not
  by learning a bigger DSL.

### The XML→EJB MDM generators (the author's own, ~2006)

The Model-Driven-Architecture era pattern (AndroMDA, XDoclet, home-grown
XML models): one XML file defines the entities; generators emit EJBs, DAO
layers, and validation for both frontend and backend. It worked — a
whole MDM system ran on it — and its virtues are exactly the ones worth
recovering: *one model artifact drives every layer; validation is written
once*. Its era-specific pains: generated code nobody wanted to read,
"protected regions" for hand edits that broke on regeneration, toolchains
that rotted, and UML/MDA ceremony that collapsed under its own weight.
MDA died on the round-trip problem; the idea didn't.

## The round-trip problem — five answers on one table

| Strategy | Used by | Cost |
|---|---|---|
| Never regenerate (starting point only) | ScaffoldHub, Rails scaffold | model is disposable; truth moves to code on day 2 |
| Protected regions in generated files | MDA/XDoclet era | fragile, ugly, still merges by hope |
| Three-way git merge on regen | JHipster (`upgrade`) | honest, but real conflicts land on you |
| Don't generate — interpret a DSL at runtime | ActiveAdmin | no drift, but the DSL becomes a cage |
| Don't generate *and* no DSL — defaults + plain-code overrides | Administrate | smallest surface; fewest capabilities out of the box |

## What this family enables

- Day-one completeness with the whole validation/test story included —
  the experience the author has been chasing since the XML→EJB system.
- Code you can read, refactor, and own: no engine to trust blindly, no
  vendor to outlive.

## Downsides (shared)

- The model stops being the truth the moment output is edited — every
  strategy above is a mitigation, none is a cure.
- No runtime authoring: admins and users can't change anything without a
  developer cycle. (ActiveAdmin/Administrate escape this only because
  they gave up generation.)

## What Featherbase should adopt

- **D19, stated as this family's synthesis:** runtime interpretation is
  the source of truth (Featherbase already is this); generation exists
  only as *one-way derived artifacts* — TypeScript types, typed API
  clients, hook stubs, test skeletons, seed fixtures — regenerable at any
  time precisely because nobody edits them. The full **eject** of a
  DocType to owned code is the deliberate off-ramp: one-way, ScaffoldHub
  ownership rules apply, and re-entry happens only through Axis C
  adoption (reflection of what the table became), never by merging code
  back into metadata.
- **Administrate's principle as the extension philosophy:** defaults
  derived from metadata; overriding means writing an ordinary hook /
  ordinary component through the contribution points (D11) — never a
  second DSL layer between the user and the platform.
- **Rails' convention-over-configuration** applied to DocType JSON: every
  field the author doesn't specify should have an obvious derived default
  (label from fieldname, list columns from first fields, etc.) — the
  model stays small enough to read, which is what "simple where possible"
  cashed out to in the XML system too.
- **From the XML→EJB system:** validation defined once in the model and
  enforced on both sides — Featherbase already does this (Zod from
  DocType JSON, shared package); guard it as a hard invariant.

**Do not adopt:** protected regions in any generated artifact; DSLs that
aren't the DocType JSON itself; treating generated code as a second
source of truth.

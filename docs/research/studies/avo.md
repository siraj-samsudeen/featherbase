# Avo — the modern Rails admin: resources, fields, and escape hatches

> Study, 2026-07-26. Family: **runtime interpreter** (of Ruby resource
> classes). The modern successor to ActiveAdmin/Administrate — very
> plausibly the "beautiful Ruby project with admin panel" remembered from
> earlier discussion, and the best current expression of the
> defaults-plus-escape-hatches philosophy in any ecosystem.

## What it is

A Rails admin-panel framework / internal-tool builder (open core,
commercial tiers): one generator command per model produces a `Resource`
class; you declare **fields** on it and Avo renders index/show/edit/create
views, filters, search, associations, and **actions** (custom operations
run on selected records) — all from those Ruby declarations, at runtime.

## Key dimensions

1. **The Resource class is the unit of configuration.** One plain Ruby
   class per model: `field :name, as: :text`, `field :status, as:
   :select`, associations, visibility rules (`visible on: :index`),
   authorization via Pundit policies. Declarative, but ordinary Ruby —
   readable, diffable, greppable. No separate DSL universe (ActiveAdmin's
   trap) and no bare-metal minimalism (Administrate's trade).
2. **Field types as the extension currency.** A rich built-in field
   library (badges, key-value, trix, files, gravatar…) plus **custom
   fields** generated as tiny component bundles (Ruby + ERB/Stimulus) —
   the fieldtype-as-plugin economy, same shape as Directus interfaces and
   Featherbase's D11 fieldtype contribution point.
3. **Actions, filters, dashboards as first-class objects** — each its own
   small class, declared then rendered; the same
   named-object-bound-to-scope pattern as Jira schemes, at Rails scale.
4. **"Designed so you can't get stuck": layered escape hatches.** This is
   Avo's stated philosophy and its real contribution: customize a field →
   custom field; customize a view → custom component per resource;
   outgrow Avo on one screen → **custom tools** (arbitrary Rails
   views/controllers mounted inside Avo's layout, with its nav and auth).
   Every level of "the framework doesn't do X" has a designed exit that
   keeps you *inside* the product instead of forking out of it.
5. **Open-core with per-tier features** (licensing gates advanced fields,
   menus, etc.) — sustainable, with the usual adoption friction.

## What it enables

- ActiveAdmin-class speed with modern Rails (Hotwire-era) internals and
  none of the legacy DSL's fight-the-framework endgame.
- Teams customize progressively — the distance between "generated
  default" and "fully bespoke screen" is a ramp, not a cliff.
- The resource-class idiom doubles as documentation: reading
  `app/avo/resources/*.rb` tells you what the admin does.

## Downsides

- Developer-only authoring: like every code-configured admin, an
  end-user/admin persona can't add a field at runtime — the Featherbase
  gap again.
- Configuration lives per-app; there's no packaging/sharing story for
  resources across projects beyond gems — no marketplace of domain
  modules.
- Commercial gating of individual features inside an open-source
  framework blurs what "using Avo" means for OSS projects.
- Young compared to its ancestors; API still evolves.

## What Featherbase should adopt

- **The escape-hatch ladder as a design requirement (D11/D14):** for
  every generated surface, define the named next step — metadata tweak →
  layout override → custom fieldtype → custom view component → custom
  page ("custom tool") — each staying inside the platform's nav, auth,
  and theme. Write this ladder into the Desk's contribution-point spec
  explicitly; "you can't get stuck" is a testable product property, not a
  slogan.
- **Fields as small, generatable component packages:** Avo's custom-field
  generator (scaffold a working fieldtype in one command) is the DX bar
  for Featherbase's fieldtype contributions.
- **Actions as first-class scoped objects (Axis A):** module admins
  defining "run on selected records" operations with their own
  authorization — a natural, high-value contribution point the design
  doc hasn't listed explicitly yet (it fits under D11's workflow/logic
  row).
- **Resource-class readability as the bar for DocType JSON:** a DocType
  definition should read as pleasantly as an Avo resource file — this is
  Rails' convention-over-configuration lesson (generator-family study)
  restated for the metadata side.

**Do not adopt:** per-app-only configuration with no packaging (Axis D
exists to beat this); feature-gating inside the core contribution surface
(gate hosted services and support, not contribution points).

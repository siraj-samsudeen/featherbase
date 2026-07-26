# Odoo — module composition over shared models, and the upgrade toll

> Study, 2026-07-26. Family: **runtime interpreter** (Python classes +
> XML data, loaded per-database). Included as the largest working example
> of "many apps, ONE database, modules extending shared entities" — the
> §2.4/§3.5 confirmation — and as the cautionary tale about upgrades.

## What it is

An open-core ERP suite (CRM, accounting, inventory, HR, e-commerce, …)
built on one framework: Python model classes (ORM), XML-defined views and
data, one Postgres database per company instance, and an addon/module
system through which *everything* — including Odoo's own apps — is
delivered.

## Key dimensions

1. **One database, shared models, modules extend in place.** A module
   doesn't create its own parallel world: `_inherit = 'res.partner'`
   adds fields and behavior to the *same* partner model every other
   module uses. Sales, accounting, and HR all enrich one Customer.
   Composition over duplication, enforced by the framework.
2. **Manifest + dependency graph.** Each module declares `depends`;
   install pulls dependencies in; `auto_install` triggers glue modules
   when two others coexist (the "bridge module" pattern — connect A and
   B only when both are present).
3. **Views are overridable XML data.** UI is records (view definitions)
   that modules override via XPath inheritance — the same
   extend-don't-copy philosophy applied to screens.
4. **Runtime customization via Studio / `ir.model.fields`:** fields and
   views can be added from the UI, stored as `x_`-prefixed metadata rows
   — a second, data-level customization layer on top of module code.
5. **OCA (Odoo Community Association):** a federated GitHub organization
   maintaining thousands of community modules with shared review
   standards and per-version branches — the governance model that keeps
   an open module ecosystem coherent.

## What it enables

- The deepest functional suite in open source, assembled from ~40k
  modules, precisely because modules *compose on shared entities*
  instead of shipping parallel tables — cross-app links, one partner,
  one chart of accounts.
- Bridge modules give "take only the parts you need" at the integration
  level: install `sale` and `stock`, and `sale_stock` auto-installs the
  glue.
- OCA proves community maintenance of business modules can work for
  decades.

## Downsides

- **Major-version upgrades are the ecosystem's chronic pain.** Model and
  view changes between versions break modules; every module must be
  ported per version (OCA maintains one branch per Odoo version);
  database migrations need OpenUpgrade or paid Odoo upgrade services.
  The cause: extensions patch *implementation surfaces* (model
  internals, view XPaths) rather than declared contracts — there are no
  manageability rules (D13) marking what's stable.
- **View-inheritance archaeology:** five modules XPath-patching the same
  form produce breakage whose origin is genuinely hard to trace —
  override stacking without ownership metadata.
- Open-core tension: enterprise-only features (including Studio) and
  license changes have repeatedly strained the community.
- Python-in-process extensions mean a bad module can take the whole
  instance down; no isolation tiers.

## What Featherbase should adopt

- **Composition over parallel entities (already D4/§2.4):** Odoo is the
  at-scale proof that "modules add fields to shared models" beats
  "modules ship their own tables" for ERP-shaped domains. Keep it as the
  default grain of app design.
- **Bridge/glue capabilities:** D12's capability graph should support
  `auto_enable_when: [A, B]` — Odoo's `auto_install` is the proven
  pattern for optional integrations between independently chosen parts.
- **OCA as the community blueprint:** per-version compatibility
  labeling, shared review standards, and org-level module stewardship —
  plan the Featherbase package registry's governance on it (D15).
- **The negative lesson powering D13:** extensions must target *declared
  contribution points with manageability rules*, never raw internals —
  that is the difference between Salesforce's painless upgrades and
  Odoo's version-porting industry. This study is the strongest argument
  in the series for keeping D13 strict.

**Do not adopt:** XPath-style override-anything extension (archaeology by
design); unversioned extension surfaces; in-process-only trust (D14's
tiers exist for a reason).

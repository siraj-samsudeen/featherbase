## Why

Feather Dash decides what each store manager sees from nine tables, each one a
store workbook or an HR export loaded one-for-one (#449). The tables disagree
with one another and keep no history: entering a change overwrites the previous
holder. Corrections live in side tables that a re-import overwrites. Floor
Managers have no codes, so they get no coverage.

The instance owner settled a clean model in a design walkthrough on
27-Oct-2026. The walkthrough is recorded in the client's private repository;
this change carries only the decisions, with synthetic examples. It covers:

- a **store layout**: store, floor, section, the owning section of each
  subcategory, and display locations;
- a dated **store org chart**: one table of job assignments with reporting lines;
- **coverage** worked out from those, never stored;
- **one alias table per entity** in place of a single mapping table;
- a **decentralised maker-and-checker** for who may change them;
- a **clean-first migration** that uses Featherbase itself as the cleaning tool.

This change is the **design umbrella**. It is docs only. Its tasks stay open
while the build PRs land, and each build PR carries and archives its own
change.

## What Changes

- **New capability `store-org-chart`** (the Feather Dash client app, ADR 0013):
  - the layout tables;
  - `job_assignment`;
  - the coverage rules;
  - org-chart conflicts and needs matching;
  - the alias tables;
  - write rules;
  - per-store cut-over.

  Like `feather-dash`, its spec moves to the client's repository with the app
  in B6′ (#550). It is written here, with synthetic data, so that the platform
  issues it needs can be reviewed against it.
- **Four generic platform features** (ADR 0011). Each has its own issue and
  will have its own change:
  - #626: import remembers hand edits;
  - #627: configurable maker-and-checker approval rules;
  - #628: "What can this person see, and why";
  - #629: a glossary.
- **The Feather Dash scope provider (B2, #559/#616) computes the coverage
  rules here.** The platform's scope shape and the `person_scope` policy do not
  change.
- **BREAKING (for the instance, not the platform).** These are retired at each
  store's cut-over:
  - the nine roster tables;
  - `value_mapping` (never built);
  - every override table;
  - `sales_target_assignment`.

## Capabilities

### New Capabilities

- `store-org-chart`: the store layout, the dated store org chart, coverage
  worked out from them, conflicts and needs matching, aliases, who may write,
  and the per-store move off the old sheets.

### Modified Capabilities

None in this change. The platform features change `spreadsheet-import` (#626),
`workflow-and-approvals` (#627) and `trusted-runtime-packages` (#628, #629)
through their own changes.

## Impact

- **Client repository:**
  - the Feather Dash app gains the tables, views and scope provider inputs, and
    a Store org chart page;
  - a one-time preparation script builds clean rows from the store HR team's
    files.
- **Platform:**
  - the four issues above;
  - #462, because the new tables decide scope (`decides_scope`) and so are
    locked to System Managers until #462 lets a scoped role write them;
  - #617, which versions any new extension point.
- **Migrations:** none in this change. Any that the build needs are claimed on
  #566 first.
- **Pending the business owner's answers** (marked in the spec):
  - extra jobs for cashiers and assistant titles;
  - how Floor Managers map to floors;
  - the details of seasonal redeployment;
  - who approves placement.

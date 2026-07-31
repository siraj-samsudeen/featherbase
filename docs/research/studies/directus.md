# Directus — database-first reflection as a product

> Study, 2026-07-26. Family: **runtime interpreter**. Included because it
> is Axis C shipped commercially: the proof that "sit on any existing SQL
> database, impose nothing" works — and a preview of its limits.

## What it is

An open-source "backend-as-a-service / data platform" that wraps **any
existing SQL database** with a REST + GraphQL API and an admin app (the
Data Studio), by *introspecting* the schema rather than owning it. Its own
metadata (collections config, permissions, flows, users) lives in a
handful of `directus_*` tables placed *beside* yours.

## Key dimensions

1. **Database-first, not framework-first.** Tables are the truth;
   Directus reflects them and layers presentation metadata on top. No
   naming conventions, no required columns, no prefixes — the direct
   validation of Featherbase's anti-`tab_` stance (D2) and adoption mode.
2. **Metadata beside the data.** `directus_*` tables coexist with the
   inspected schema in the same database — adoption without invasion.
3. **A complete extension taxonomy.** Nine types — interfaces (field
   widgets), displays, layouts, modules (pages), panels (dashboard),
   hooks, endpoints, operations (flow steps), bundles — cleanly split
   app-side vs API-side. The best-organized plugin surface in this study
   series after VS Code.
4. **Flows** — event/schedule/webhook-triggered no-code automation with
   operations as pluggable steps.
5. **Schema snapshot / diff / apply.** The CLI can snapshot the schema +
   config to a file, diff it against another instance, and apply — their
   answer to promotion across environments (Axis F), git-friendly.
6. **Permissions as data**: role/field/item-level rules with dynamic
   variables, enforced in the API layer (not the database).

## What it enables

- Point it at a legacy database and get an admin UI, API, and
  permissions **today**, with the CLIs/apps that own that database
  untouched — the doctor's-clinical-system move, productized.
- Refactor-friendliness: because the DB is the truth, renaming with
  ordinary migration tools doesn't fight the platform.
- Its extension taxonomy lets agencies ship polished custom field
  widgets — the fieldtype-as-plugin economy in miniature.

## Downsides

- **Business logic is thin by design.** Database-first means there is no
  rich document lifecycle: no equivalent of the
  validate→before_save→transaction→after_save chain, submittable
  documents, or naming series. Complex invariants end up in hooks/flows
  scattered per-collection, or back in application code. (Featherbase's
  differentiator: adoption *plus* a real document engine.)
- **API-layer permissions only** — the database itself is open to anyone
  with a connection string; there's no RLS story. Fine for its
  positioning, but weaker than Featherbase's local-Postgres RLS + server
  gate combination.
- Introspection-driven metadata can drift confusing when other tools
  migrate the schema mid-flight (their snapshot/diff mitigates, not
  cures).
- License: moved from GPL to BSL-style source-available with a revenue
  threshold — a reminder that ecosystem trust depends on license
  stability (relevant to Featherbase's own positioning as the
  free/open option).

## What Featherbase should adopt

- **The reflection UX bar (Axis C):** browse → propose → adjust → adopt,
  with live re-sync diffs. Directus proves users expect this to be
  effortless.
- **Snapshot / diff / apply as the promotion primitive (D17):** metadata
  + implied DDL, exportable to a file, diffable in git, applyable with a
  plan preview. Directus shipped the mechanics; Featherbase adds the
  layer stack (D13) on top.
- **The extension taxonomy names (D11):** interfaces/displays/layouts/
  modules/panels/operations is a proven, teachable vocabulary — reuse it
  rather than inventing synonyms.
- **Beside-the-data metadata placement** for adopted databases (already
  implicit in adoption mode; Directus is the precedent that it scales).

**Do not adopt:** database-first *thinness* — Featherbase's document
lifecycle, permissions-in-depth (RLS + server), and naming series are
precisely the value the overlay adds; giving them up would make it a
second Directus instead of a better Frappe.

# Salesforce — the governed metadata platform

> Study, 2026-07-26. Family: **runtime interpreter** (the most successful
> one ever built). The author admires the design without having worked in
> it — this study is the "what's actually inside" briefing, and the
> measure of which parts survive translation to an open, self-hosted
> world.

## What it is

A multi-tenant platform where **every customization is metadata**:
objects, fields, layouts, validation rules, flows, permissions, even most
"code" artifacts are rows interpreted by one shared runtime that
Salesforce upgrades three times a year — for every tenant simultaneously,
without breaking them.

## Key dimensions

1. **Metadata-driven multitenancy.** One giant runtime; an *org*
   (tenant) is a pile of metadata + data. Nothing a customer does forks
   the platform. This is the extreme end of the interpreter family, and
   the reason seasonal upgrades are even possible.
2. **Declarative first, code governed.** Admins build with objects,
   record types, page layouts, validation rules, and Flow; developers
   add Apex/LWC — but code runs under **governor limits** (SOQL query
   caps, CPU time, heap) because the runtime is shared. Code is a guest;
   metadata is the citizen.
3. **The admin is a first-class builder persona.** An entire profession
   ("Salesforce admin") exists because the platform treats declarative
   builders as its primary customer, with certification paths and
   tooling. Not an afterthought UI over a developer product.
4. **Record types + page layouts + field-level security** specialize one
   object per audience — the pattern the Featherbase design adopted for
   ticket types (D4).
5. **Permission sets over profiles.** The permission model migrated from
   monolithic *profiles* (one per user) to composable, additive
   *permission sets* — grant-shaped bundles stacked per user. Roles
   remained for record-level sharing hierarchy, separate from object/field
   rights.
6. **Packaging with manageability rules (2GP).** A managed package's
   components carry per-type rules for what subscribers may edit;
   upgrades are versioned, dependency-aware, and can be pushed. The
   AppExchange sits on top with security review.
7. **Sandboxes + staged deployment.** Change is authored in sandbox
   orgs and promoted (change sets historically; SFDX/source-tracked
   deploys now) — the change-lifecycle axis (F) as a product.

## What it enables

- **Upgrades that never break customers** — the manageability contract
  is why a 25-year-old platform ships three releases a year onto every
  tenant. This is the single most enviable property in this study series.
- The largest ISV economy in enterprise software (AppExchange), because
  packaging + review + upgrade-safety make third-party software
  *operable* by non-engineers.
- Non-developers building real systems, at scale, for decades.

## Downsides

- **Org sprawl is the platform's tech debt.** Twenty years of admins ×
  no forced cleanup = thousands of fields, flows, and rules nobody dares
  touch. Metadata debt is real debt; the platform's power to accrete is
  also its curse. (Featherbase's Axis E/F — history and promotion with
  plan-preview — are partial antidotes.)
- **Governor limits are opaque rage-generators** — necessary for shared
  tenancy, but they surface as mysterious production failures.
  Self-hosted Featherbase doesn't need them; per-tier resource honesty
  (Axis D trust tiers) is the open-world equivalent.
- Proprietary everything: language (Apex), UI framework (LWC), query
  (SOQL) — the learning curve and lock-in are the price of the governed
  runtime.
- Declarative testing is weak (Flows are hard to test), the classic
  interpreter-family weakness; code has enforced coverage, metadata
  mostly doesn't.

## What Featherbase should adopt

- **Manageability rules (D13)** — already adopted; this study is the
  evidence for *why*: it is the load-bearing wall of the whole ISV/
  upgrade story.
- **Permission sets (Axis A refinement):** model grants as additive,
  composable sets attached to users/roles rather than ever-growing
  monolithic roles. Frappe's role model is closer to profiles; take the
  newer lesson.
- **The admin persona as a product requirement:** module admins (Axis A)
  deserve first-class tooling, docs, and guardrails — not a scaled-down
  developer UI.
- **Sandbox/promotion (D17)** — adopted; Salesforce is the proof it can
  be product-grade rather than a git workflow for engineers only.
- **Metadata debt countermeasures** Salesforce lacks: usage analytics on
  fields/types ("last used"), deprecation states, and plan-preview diffs
  (D17) from day one.

**Do not adopt:** governor limits (wrong trade for self-hosted);
proprietary language/UI layers (TypeScript + open standards are the
point); profiles-style monolithic permissions.

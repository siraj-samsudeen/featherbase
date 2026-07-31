# ServiceNow — table inheritance, scoped apps, and the update-set warning

> Study, 2026-07-26. Family: **runtime interpreter**. Included for two
> reasons: it runs the generic→specific record pattern (Axis A / D4) at
> the largest enterprise scale in existence, and its change-promotion
> mechanism (update sets) is the definitive cautionary tale for Axis F.

## What it is

The dominant enterprise service-management platform (ITSM and far
beyond): one platform database, everything — incidents, changes, users,
*and the platform's own configuration and code* — stored as records in
tables, edited through the platform itself, with per-instance (not
multi-tenant) deployment.

## Key dimensions

1. **Table inheritance from a `task` base.** `incident`, `change_request`,
   `problem`, and hundreds of others *extend* the `task` table:
   shared columns (assignment, state, SLA hooks) live on the base;
   extensions add their own. Generic list/form machinery, assignment
   engines, and SLAs are written once against `task` and work for every
   descendant. This is the ancestor of the design doc's
   base-entity + subtype decision (D4) — proven at billions of rows.
2. **Everything is a record.** Business rules (server scripts), UI
   policies, workflows, even script includes are rows — so one audit
   trail, one history mechanism, and one access model cover data *and*
   configuration alike (Axis E for free, structurally).
3. **Scoped applications.** Later-era ServiceNow apps get a namespace
   (`x_acme_*`), private tables, explicit cross-scope access grants, and
   delegated development rights — the platform's answer to "module admin"
   and app isolation after a decade of global-scope chaos.
4. **Update sets: change capture as recorded diffs.** Configuration
   changes in a dev instance are captured into an "update set" — a bag
   of changed records — exported and applied to test/prod instances.
5. **Flow Designer / IntegrationHub:** declarative automation with
   pluggable "spokes" (connector packs) — their sync-binding economy.

## What it enables

- One platform serving hundreds of enterprise use cases with uniform
  audit, SLA, assignment, and reporting — the payoff of the `task` base
  and everything-is-a-record.
- Delegated app development inside giant orgs without global blast
  radius (scoped apps — arrived late, but it worked).
- An enormous services economy — proof that "platform + governed
  customization" scales commercially beyond even Salesforce in the
  service domain.

## Downsides

- **Update sets are the wrong promotion unit, famously.** They capture
  *what happened to records*, not *what the configuration should be*:
  partial captures (a change made outside capture is silently missing),
  order-dependence between sets, collisions on shared records, and no
  real diff/preview. Entire consultancies exist to clean up bad update-set
  promotions. The lesson for Axis F is precise: **promote declared
  states with a plan (snapshot/diff/apply, D17 + Directus study), never
  recorded change-bags.**
- Global-scope legacy: pre-scoping customizations (still everywhere in
  old instances) patch shared artifacts with the same archaeology
  problems as Odoo's views.
- Per-instance architecture means every customer runs their own upgrade
  project; upgrades routinely break customizations that touched
  out-of-contract surfaces ("skipped records" reviews are a ritual).
- Proprietary, expensive, and JavaScript-in-a-box: the developer
  experience is the platform's, not the ecosystem's.

## What Featherbase should adopt

- **`task`-style base entities (D4), consciously:** design the helpdesk
  (and any ERP domain) around a shared base with subtype field-sets, and
  write engines (SLA, assignment, routing) against the base — the
  ServiceNow proof is that this single choice is what makes "100 ticket
  types" cheap.
- **Everything-is-a-record symmetry (Axes E/G):** Featherbase already
  stores DocTypes as data; extend the same audit/versioning machinery to
  *metadata changes* so config history and data history are one system —
  ServiceNow shows how much operational value that symmetry yields.
- **Scoped-app namespacing (Axis A/D):** package-owned artifacts carry
  their owner's identity, and cross-scope access is an explicit grant —
  arrive at this on day one rather than after the global-scope decade.
- **Spokes/connector packs as packaged sync bindings (D6 + D12):** a
  "SAP spoke" = a package contributing a driver + crosswalk templates +
  prebuilt flows.

**Do not adopt:** update sets (D17 exists specifically to not be this);
per-instance upgrade projects (D13's layer contract is the alternative);
global mutable scope as the default.

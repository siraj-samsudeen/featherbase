# Jira — schemes, request types, and the cost of two config paradigms

> Study, 2026-07-26. Family: **runtime interpreter**. Included because the
> helpdesk requirement (departments with their own ticket types under a
> company-wide admin) is Jira Service Management's home turf, and because
> Jira carries twenty years of scar tissue about *sharing configuration
> across scopes* — exactly Axis A's hard problem.

## What it is

Atlassian's issue tracker: projects contain issues of configurable
*issue types*, governed by workflows, screens, fields, and permissions —
all runtime configuration. Jira Service Management (JSM) adds
customer-facing portals over the same engine.

## Key dimensions

1. **Schemes: named, reusable configuration objects.** A workflow scheme,
   screen scheme, field configuration scheme, permission scheme, or
   notification scheme is defined *once* and **bound to many projects**.
   Change the scheme, and 200 projects change together. Configuration is
   normalized, not copied.
2. **Custom fields are global.** One "Severity" field exists
   instance-wide and is *associated* with contexts/screens. Single
   definition, shared semantics — and a famous failure mode (below).
3. **JSM request types: a persona view over an internal type.** A portal
   "Report a broken laptop" request type maps onto an internal issue
   type, with its own portal form (subset of fields, friendlier names)
   and is owned by **project admins**, not instance admins. Customers see
   request types; agents see issue types. Two audiences, one record.
4. **Two project paradigms.** *Company-managed* projects share global
   schemes (power, central control); *team-managed* projects own their
   config in isolation (simplicity, delegation). This was Atlassian's
   answer to the delegated-admin demand — shipped as a **second,
   incompatible configuration model**.
5. **Issue-type hierarchy is shallow and fixed** (epic → issue →
   subtask); everything else is fields and links — Jira resisted deep
   type inheritance and mostly got away with it.

## What it enables

- Enterprise-scale governance: one workflow change rolls out everywhere
  it's bound; auditors love schemes.
- The UN-case workflow, natively: a customer files a vague request in a
  portal; triage moves it across request/issue types and projects; each
  desk's admin shapes their own types and SLAs within delegated bounds.
- The portal/agent split (Axis G's external-human persona) with zero
  duplication of the underlying record.

## Downsides

- **Scheme indirection is notoriously confusing.** Five scheme layers
  between "I want a field on this screen" and it appearing means admins
  routinely fail the *"why does this project behave like this?"* test.
  Normalization traded readability for reuse and never bought it back
  with good tooling.
- **Global custom-field pollution.** Because fields are instance-global
  and creation was historically easy, big instances accumulate thousands
  — with duplicate near-identical fields ("Severity", "severity level"),
  and real performance degradation. A global namespace without
  scoped ownership rots. (The exact disease D4's *scoped* field-sets are
  designed to prevent.)
- **The two-paradigm split is the deepest lesson.** Team-managed vs
  company-managed means two permission models, two field systems, and
  features that exist in one but not the other — a permanent fork in the
  product's brain, because delegation was bolted on as a separate mode
  instead of being a *scope* in one model.

## What Featherbase should adopt

- **Schemes, generalized (Axis A):** SLAs, workflows, permission
  bundles, and layouts should be *named objects bound to scopes*
  (module/type), never per-scope copies. Featherbase's advantage: bind
  them through ordinary Link fields with an "where used" view, so the
  indirection Jira hides is a visible, queryable graph.
- **Request types → the portal face of D4:** a Type registry entry
  should optionally carry a *portal presentation* (subset of fields,
  public labels, intake form) distinct from the internal one — the
  generic "I don't know where this belongs" intake is just the
  global-scope request type.
- **Delegation as scope, not as mode:** one configuration model where a
  module admin's power is a *scoped slice* of the same objects the app
  admin manages (D3). Never ship a second, simplified config system —
  that's how you get Jira's fork forever.
- **Field governance from day one:** scoped ownership (D4), usage
  visibility, and dedup suggestions at creation time ("a global field
  'Severity' already exists — reuse it?").

**Do not adopt:** five-layer scheme indirection without a "why does this
behave this way" explainer; a global flat custom-field namespace;
paradigm forks.

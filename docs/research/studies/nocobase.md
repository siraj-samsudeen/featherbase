# NocoBase — microkernel, everything is a plugin

> Study, 2026-07-26. Family: **runtime interpreter**. The closest existing
> open-source system to the Featherbase target; the author has actively
> tried to use it and admires its plugin mechanism. Study it as the
> nearest competitor *and* the richest source of validated decisions.

## What it is

An open-source, self-hosted no-code/low-code platform (TypeScript,
Koa + React) for building business systems, whose defining trait is
architectural: **the core does nothing but plugin lifecycle scheduling,
dependency management, and base infrastructure — every business
capability is a plugin.**

## Key dimensions

1. **Microkernel.** `@nocobase/server` (Koa app, resource routing) and
   `@nocobase/client` (React shell, schema rendering) are the kernel;
   collections, workflow, auth methods, file storage, even the **data
   source manager** are plugins. WordPress-style install/enable/disable
   at runtime.
2. **A plugin is server + client in one package.** Data logic and UI
   interactions ship and version together; the plugin manager handles
   activation and dependencies.
3. **Data sources are plugins too.** The "main" database is itself a
   data-source plugin; external MySQL/Postgres/API sources are more of
   the same — the storage layer was born pluggable rather than
   retrofitted.
4. **UI is schema-rendered.** Pages and blocks are JSON UI schemas
   interpreted by the client; building a UI means composing schema, and a
   plugin contributes blocks/actions as schema components.
5. **Separation of data model from UI.** Unlike spreadsheet-flavored
   tools (Airtable-likes), collections are modeled independently and
   multiple blocks/views present them — the same DocType/Desk separation
   Featherbase inherits from Frappe.

## What it enables

- Third parties can build features with exactly the power of core
  features — the dogfooding guarantee, structurally enforced.
- Deployments enable only what they need; the product scales down
  gracefully (a quality Frappe lacks — you get all of Frappe or nothing).
- External databases as first-class citizens validate Featherbase's
  Axis B ambition commercially.

## Downsides

- **Young-ecosystem tax**: plugin API churn between versions, thin docs
  for plugin authors, community plugins lagging releases. (The likely
  friction behind "actively tried to use.")
- **Schema-rendered UI is opaque to debug** — when a block misbehaves,
  you're spelunking JSON schema and renderer internals, not reading
  component code. Powerful, but the escape hatch to "just write a
  component" matters and is where the seams show.
- Commercial/open split on key plugins complicates adoption decisions.
- The microkernel discipline has a cost: even trivial features carry
  plugin packaging ceremony.

## What Featherbase should adopt

- **D10 verbatim** — the microkernel/dogfooding rule is NocoBase's core
  proof: it works in this exact product category, in TypeScript, today.
- **Server+client-in-one-package plugins (D11)** — contribution points
  spanning both halves, versioned together.
- **Data-source-as-plugin** — direct validation of Axis B's driver model
  (D5/D7); their external-DB plugins are prior art worth reading before
  implementing spec 0001.
- **Declarative UI contributions (D14)** — schema-rendered blocks as the
  default contribution form, with full-code components as the trusted-tier
  exception.
- **Their plug-and-play lifecycle UX** (install → enable → configure in
  the running app) as the bar for Featherbase's app manager.

**Do not adopt:** schema-everything without a first-class plain-code
escape hatch (Administrate's lesson applies); unversioned plugin API
surface — Featherbase's answer is conformance suites per contribution
type (D15) so the API contract is executable, not aspirational.

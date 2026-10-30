# ADR 0011: Platform, App, Instance

**Status:** Accepted · **Date:** 2026-10-26 · **Corrected:** 30-Oct-2026 (#705) · **Issue:** [#458](https://github.com/siraj-samsudeen/featherbase/issues/458) · **PR:** [#460](https://github.com/siraj-samsudeen/featherbase/pull/460)

> **30-Oct-2026 correction (#705).** The amendments from
> [ADR 0013](0013-client-apps-and-product-apps.md) and
> [ADR 0014](0014-one-repo-for-platform-and-apps.md) are now written into the
> text below, so it reads as one current decision:
>
> - There are two kinds of app. A **product app** never hard-codes one
>   client's values; a **client app**, built for one client, may (ADR 0013).
> - Apps live in this repository, beside the platform: product apps in
>   `example-apps/`, client apps in `client-apps/<client>/<app>/`. Each client's
>   instances live in `client-apps/<client>/instances/` (ADR 0014). The
>   small packages the tests install to prove one feature each live in
>   `test-apps/` (#703).
> - The one-way rule is no longer kept by a repository boundary. Two checks
>   keep it: `pnpm check:platform-imports` fails when platform source imports
>   anything from `example-apps/`, `client-apps/` or `test-apps/` (#703), and
>   `apps/server/test/platform-names-no-app.test.ts` pins that platform code
>   names no app.

## Context

Featherbase is about to serve its first production client. Until now the line
between the product and what one client needs was drawn case by case. The
Sales Target report was written into the platform's own web app, and one
client's seed pack and release runbook were checked in as platform material.
Each was reasonable on the day. Together they mean a second client would have
to change platform code.

The owner reviewed how other platforms draw these lines before the first
production deployment, rather than after it:

- **Django and Frappe** let many apps share one instance. Frappe also lets
  admins customise at runtime. Its upgrades are painful because apps may reach
  into, and patch, the core.
- **Salesforce** keeps upgrades calm: each piece of code states the platform
  version it was written for, and the platform keeps honouring that version.
  Admins customise around a package without editing it.
- **VS Code** publishes one list of extension points ("contribution points").
  An extension declares in one file what it adds, and may touch the editor
  only through that list.
- **Shopify** dates its API versions and publishes how long each is supported.
  It lets apps attach their own fields to platform records under their own
  name, and shows a merchant what an app may touch before it is installed.
- **WordPress** lets plugins hook named moments: an *action* does something
  then, and a *filter* changes a value passing through. Child themes change the
  look without touching the original. Its marketplace is also its weak spot,
  because every plugin runs with full power.

## Decision

### Three layers

| Layer | What it is | Where it lives |
|---|---|---|
| **Platform** | Featherbase itself: sign-in, Tables, forms, roles, the Admin screens, and the rules for installing apps | This public repository. The same for every client |
| **App** | Something installable on an instance, with its own pages, Tables, roles and code (Tasker, Feather Dash) | Its own folder and version number in this repository: `example-apps/` for product apps, `client-apps/<client>/<app>/` for client apps (ADR 0014) |
| **Instance** | One running copy for one client: one server, one database, and that client's settings, data, people and choice of apps | The client's `client-apps/<client>/instances/<instance>/` (ADR 0014), and the database itself |

In prose, the middle layer is called an **app**. The code's name for it
(`runtime package`) is used only when pointing at a file.

### One-way knowledge

**Each layer knows only the layer below it.** The platform never names a
client or an app. A product app never hard-codes one client's values; they
reach it as settings or instance setup. A client app, built for one client,
may hold that client's values, within the limits in ADR 0013. The instance
chooses apps and fills in their settings.

The test for any file: *if a second client arrived tomorrow, would this file
have to change?* If yes, it is in the wrong layer. This is the most important
rule in this ADR, and every design is checked against it.

### Three kinds of change

| Kind | Who makes it | How | Survives upgrades |
|---|---|---|---|
| Instance change | admins, in the UI, at runtime | saved as data | always |
| App release | app developers, in code, through pull requests | a versioned build | yes, through its platform version |
| Platform release | the platform's maintainers | a Featherbase release | must not break the other two |

### Principles

1. **Instance people change a lot at runtime, in the UI**: new Tables, fields,
   forms, layouts and pages.
2. **App developers work in code, through pull requests**, in this repository
   beside the platform, or, for a client with its own developers, in a private
   copy of it (ADR 0014).
3. **A platform release never breaks an app or an instance.** Each app states
   the **platform version** it was built for, a month such as `2026-10`, in its
   manifest. Each platform version is supported on a published calendar, and
   apps are warned before it ends. "API" is reserved for the REST API.
4. **One catalogue of extension points.** Every way an app or an instance may
   extend the platform is listed in one place, VS Code style: hooks (actions and
   filters), pages, layouts, fields, settings, bar controls and so on. An app
   may touch the platform only through that catalogue.
5. **When several instances want the same thing, it can be lifted into the
   platform.** This is a reviewed process, not a feature.
6. **Lift and shift.** An app can move out to its own repository, or an outside
   app can be brought in, with its code, configuration and data. Work built in
   the UI can become app code: **one Table definition format is used
   everywhere**, so moving a Table between the UI and an app is a change of
   owner, never a rewrite (#484).
7. **One-way knowledge**, as above.

### Patterns adopted

- **Hooks, as actions and filters** (WordPress).
- **Change the look without touching the original** (WordPress child themes).
  Instance customisations sit on top of an app and survive its upgrades. If an
  upgrade removes what a customisation points at, the customisation is shown as
  orphaned, never as a broken page.
- **The install screen lists everything an app can touch** (Shopify, Android),
  in plain words: "Can read: people's names and stores", not "Person: read".
  The list of installed apps shows what each one adds (VS Code).
- **Dated platform versions with a support calendar** (Shopify, Stripe).
- **Declared, not coded, contributions to platform chrome.** An app may add a
  control to the shared top bar by declaring it; it never runs its own code
  there.

### Future directions, recorded so nothing blocks them

- Apps attach their own fields to platform records under their own name
  (Shopify metafields).
- Export work built in the UI to app code, and move UI-built Tables and their
  rows into an app (#484).
- Templates: share an instance's setup without code (Notion, Airtable).

### Trust: no sandbox now

Apps are **trusted and reviewed**: their server code runs inside the platform
with full power. That fits today's model: apps written by the maintainers or by
a client's developers, reviewed as pull requests, and one instance per client,
so a bad app can harm only the client who chose it. Three guardrails keep a
sandbox possible later:

1. Apps touch the platform only through the declared extension points, never by
   importing platform internals.
2. Everything an app needs is declared: Tables, grants, settings, secrets and
   outside sites. Today the declaration serves review and the install screen; a
   future sandbox would enforce the same list.
3. **The host decides which apps run on a server.** Where one server serves
   several sites, an app installed there runs for every site on it.

Revisit this the day anyone wants to install an app the server's owner has not
reviewed.

### Rejected

- **A central app-hosting model** (Shopify's apps on their own servers). Each
  client runs its own instance.
- **Apps that rewrite another app's screens or logic** (Odoo, Frappe). It is
  what makes their upgrades painful.
- **A public marketplace, for now.** It needs the trust model above revisited
  first.

## Consequences

- Known breaks of one-way knowledge are fixed by named work: the Sales Target
  report moves out of the platform into the Feather Dash app (#458); a client's
  seed pack and release runbook move to the client's repository (#487); the
  platform stops naming a client's roster tables (#458 stage B, #449).
- The manifest's `apiVersion` is renamed `platformVersion`, dated by month,
  outright and without an alias.
- The extension-point catalogue is generated from the manifest's own schema and
  checked in CI, so it cannot drift from the code. *(Not yet built as of
  30-Oct-2026.)*
- Feather Dash is the first app designed against this ADR. *(Corrected
  30-Oct-2026: it was first planned as a generic app with each client's report
  definition as private instance setup; ADR 0013 made it a client app, and
  ADR 0014 brings it into `client-apps/`.)*

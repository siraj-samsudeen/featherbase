# ADR 0013: Client apps and product apps

**Status:** Accepted · **Date:** 2026-10-27 · **Amends:** [ADR 0011](0011-platform-app-instance.md) · **Issue:** [#550](https://github.com/siraj-samsudeen/featherbase/issues/550)

## Context

ADR 0011 split Featherbase into three layers (Platform, App, Instance) and set
one rule above the others: each layer knows only the layer below it. It also
said that *an app never hard-codes one client's values*: they reach it as
settings or instance setup. Feather Dash was then designed as a generic app in
this repository, with each client's report query, Dive and job bindings kept as
private instance setup.

On 27-Oct-2026 the owner decided that **Feather Dash is an app for one client**,
its first client: "I build an app for a specific client." A
future client with a similar need gets a copy to adapt, not a shared generic
app. This matches the owner's decision of 26-Oct that Feather Dash's code lives
in the client's private repository.

Other apps are meant for everyone: Feather Tickets and Feather Tasker, held
until after Feather Dash stage B, are products. So the platform has to serve
both kinds of app.

## Decision

### Two kinds of app

| | **Product app** | **Client app** |
|---|---|---|
| Built for | Any client | One client |
| Examples | Feather Tickets, Feather Tasker | Feather Dash (for its first client) |
| Lives in | Shipped with Featherbase as a first-party package | The client's own private repository |
| May carry one client's terms, values and examples | No: they reach it as settings or instance setup | **Yes**, directly |
| A second client gets | The same app, with its own settings | A copy of the code, to adapt |
| Worth it when | The same app serves many clients | One client needs it now |
| The cost | More design up front, to keep it generic | The copies drift apart |

**A feature joins the platform only when a second app needs it.** Until then, it
stays in the app that needs it. That holds for both kinds of app, and no app's
code moves into the platform.

### What does not change

- **The platform knows no app and no client.** ADR 0011's test still applies to
  every platform file: *if a second client arrived tomorrow, would this file
  have to change?*
- **Both kinds of app are the same to the platform.** They use the same
  manifest, the same declared extension points, the same `platformVersion` and
  fingerprints, and ADR 0011's three guardrails. The platform has no "client
  app" flag.
- **One-way knowledge between app and platform.** An app reaches the platform
  only through declared extension points, and the platform never reads an app's
  internals. A client app may know its client; it still may not know platform
  internals.
- **Nothing from a client's repository enters this public one.** A client app's
  code, data, names and figures stay in the client's repository. The platform's
  extension points are tested here with small generic fixture apps.

### What a client app may hold

A client app may hold the client's report queries, its terms (store, floor,
section), its job names as role suggestions, and its examples. What still stays
out of the code, as it does for a product app, is what differs between
instances of the same client or is secret:

- **secrets**, such as warehouse tokens;
- **per-instance settings**, such as the Dive used on dev versus prod;
- **job → app-role bindings**, which Admin edits on each instance (#458 D4).

### Amendment to ADR 0011

ADR 0011's sentence *"An app never hard-codes one client's values; they reach it
as settings or instance setup"* now applies to **product apps**. A client app may
hard-code its own client's values, under the limits above.

## Consequences

- Feather Dash becomes a client app in the client's repository. The split
  between a generic Feather Dash app and private instance setup (stage B parts
  B6 and B7, #550) collapses into one app there. The re-plan is recorded in the
  `feather-dash-installed-app` OpenSpec change and #550.
- The platform work of stage B stays in this repository: `platformVersion` and
  fingerprints (B1), the scope shape and `person_scope` (B2), settings, secrets
  and bindings (B3), outbound reads and `recordView` (B4), frame origins, the
  release guard and bar controls (B5).
- A platform extension point may now be filled by a client app where ADR 0011
  assumed instance setup, for example an app that declares its own cached
  dataset query. Each such case is decided in its own design, and the extension
  point stays generic.
- How a client app reaches a server is a delivery question this ADR leaves open:
  for example, a client image built on the platform's image, or an app artifact
  installed into an instance. The `feather-dash-installed-app` design decides it.
- Tasker is retired after stage B (#563). Feather Tasker, a product app, may
  return later as its own app.

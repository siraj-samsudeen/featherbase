## Why

Tickets draws a second set of page chrome under Featherbase's shared top bar: its own green rail, header, headline, subtitle and an always-on connections banner. The ticket list starts about a third of the way down the page, and Tickets navigates differently from every other app. Data-quality owners work a queue, so the queue and the ticket belong at the top. Apps may still look like themselves, but only through what the platform provides (owner, 04-Nov-2026, #941).

## What Changes

- Tickets uses the platform's shared navigation, as Tasker does, for its views (all tickets, my requests, assigned to me) and its ticket types. Its own rail, logo, breadcrumb, signed-in text and avatar go.
- The headline, subtitle and connections banner go. The connection status becomes one short line in the navigation, linking to Tickets' settings.
- The top of the page is the work: one toolbar row, then the ticket list beside the selected ticket. The ticket's header holds its title, state, assignee and the actions available now.
- New platform feature: an app can choose an **accent** colour, by name, from a set the platform provides. The accent colours the app's buttons and selected items, on its page and in the shared bar and navigation over it, in light and dark. Tickets chooses green. An app that chooses none stays on the platform's blue.
- Tickets' stylesheet moves onto the platform's design tokens and loses its own colours.

## Capabilities

### New Capabilities

- `tickets-workspace`: how Tickets sits in Featherbase: the shared navigation, the work first, and connection status kept out of the way.

### Modified Capabilities

- `trusted-runtime-packages`: an app can choose its accent colour from the platform's set.

## Impact

- `example-apps/tickets`: `src/main.tsx`, `src/style.css`, `featherbase.json` (the accent) and a version bump.
- Platform: the app manifest's validation (`apps/server`), the served app document (`runtime-shell.ts`), the bar and sidebar elements (`apps/web/src/bar`), the accent token blocks in `packages/shop-floor/src/styles.css`, and the contrast guard (`apps/web/test/design-guards.test.ts`).
- No data, permission or API change.

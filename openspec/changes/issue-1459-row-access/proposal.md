## Why

Siraj, 28-Nov-2026: the data filtering has to sit at the Featherbase level. Every Table has to be filtered through what
a person is allowed to see, and places (#1454) cannot be the only filter. Today a grant reads a whole Table unless
something happens to narrow it, so everyone who signs in reads every ticket, and everyone holding an app's role reads
every store's rows of half its Tables. Nothing made the author of a Table say which rows are whose.

## What Changes

- **New: row access.** Every Table has one row rule from a closed set: every row; a person's own rows; the person's
  places; through a reference to a row they can read; System Managers only. Some roles can be given every row. A
  Table with no rule is read by System Managers only, on every read path. A grant still decides who reaches the Table.
- An app declares the rule of each of its Tables in its manifest (`rowRules`); a System Manager can set a rule on any
  Table, which wins over the app's, and can list every Table's rule, the Tables with none and those everyone reads whole.
- **Modified: scoped app reads.** A Table about places is one kind of row rule (`places`); `scopedTables` is removed.
- **BREAKING** A Table made after this change is closed until it is given a rule. Existing platform and instance
  Tables are given "every row" by the migration, and each app in this repo declares its rules in the same change.

## Capabilities

### New Capabilities

- `row-access`: who reads which rows of a Table, and what happens when nobody has said.

### Modified Capabilities

- `scoped-app-reads`: a Table about places is declared as a row rule, by an app or a System Manager.

## Impact

`packages/shared/src/row-rule.ts`, `apps/server/src/row-rule.ts` and `app-row-rules.ts` (new, replacing
`app-scoped-tables.ts`), `query.ts`, `document.ts`, `realtime.ts`, `sources/dispatch.ts`, `table-engine.ts`,
`table-def-routes.ts`, `runtime-packages.ts`, migration `0187_row_rule.sql`; the manifests of Dash, Equipment,
Forecasting, Tasker and Tickets; every test that makes a Table. The audit and the choices are in
`docs/design/row-access.md`.

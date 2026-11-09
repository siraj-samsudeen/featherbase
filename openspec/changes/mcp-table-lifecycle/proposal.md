## Why

An agent connected over `/mcp` (#1083) can read and change rows, but not the Table they live in,
and it cannot bring in a file. The owner, checking data with an agent, wants to "do all the things
about the structure of the table and then import the data… the complete lifecycle of changing the
current table" in the same conversation, instead of leaving the agent for the Admin's Table builder,
column editor and import wizard (#1105).

## What Changes

- New `/mcp` tools to shape a Table: create one, and add, rename, change (label, required,
  choices, a text column into a link and back) or remove a column. They go through the same routes
  as the Table builder and column editor, so the same rules and refusals apply: a column's type
  stays fixed except text to link and back, a column comes out only when named and keeps its
  values, a platform Table's columns stay closed.
- New `/mcp` tools to import a CSV the way the import wizard does: suggest a Table for a file,
  check the file against a Table (a dry run that names each refused row by its row in the file),
  import the checked file (headings matched to columns by name or label, or as the agent says;
  rows matched by a key column are updated instead of added), list a Table's imports and undo one.
- An import runs only as it was checked: changing the file or its options after the check, or the
  Table's columns, means checking again. The wizard's two guards hold for an agent too: a file
  whose every row is already in the Table is added again only when the agent says so, and more
  than 20 changed rows need that count confirmed.
- Permissions (owner's decision): whoever can do it today can do it through an agent, with exactly
  the same checks: building Tables needs the System Manager role, importing needs permission to
  add (and, matching on a key, to change) the rows. No extra role, no bypass. History marks every
  imported row "via <token label>" as for any change through an agent.
- Removing a column, changing a column, renaming one, importing and undoing an import are marked
  as altering existing data, so the agent's app asks the person first; checking and suggesting
  are marked as reading only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-access`: the agent can also shape a Table, check and import a file into it, and undo an
  import, with the user's own rights; the actions that alter existing data say so.

## Impact

- `apps/server/src/mcp.ts` gains ten tools, served in-process by the existing routes
  (`/api/table_def…`, `/api/table/:table:import`, `:import-revert`, the Import Log list). A new
  module parses CSV text on the server. No new route, no schema change, no new dependency.
- `packages/shared`: the import's duplicate-key gate moves here from the web app so the wizard and
  the agent share it.
- README "Connect an agent" lists the new tools.
- Out of scope: Excel workbooks over MCP (the server has no workbook parser; an agent sends CSV),
  deleting or renaming a whole Table, deleting a removed column's values, columns added to
  platform Tables (Customize Form), import conflicts and corrections review, and the Import Log's
  "delete the Tables an import created".

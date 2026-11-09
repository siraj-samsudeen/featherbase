# Tasks

Scenarios first, then the server, one red-to-green step at a time (spec-as-source). Each fenced
scenario in `specs/agent-access/spec.md` is one Vitest test bound with
`scenarioFor(test, 'agent-access')` in `apps/server/test/scenarios/agent-access.test.ts`, driving
the real app with the MCP SDK's own client (docs/TESTING.md "Spec scenarios"). What the scenarios
leave out (argument shapes, refusals, limits, annotations) is pinned in `apps/server/test/mcp.test.ts`.
Design decisions are D1 to D6 in `design.md`.

## 1. Setup

- [x] 1.1 Move `splitForSend` (the duplicate-key gate) from `apps/web/src/lib/import-run.ts` to
  `packages/shared/src/import.ts`; the wizard and its test import it from `shared`.
- [x] 1.2 A CSV parser for the server (`apps/server/src/csv.ts`): RFC 4180 quoting, comma, tab or
  semicolon, a byte-order mark and CRLF tolerated; unit tests beside it.

## 2. Scenarios: one bound test per scenario, each red for the right reason, then green

- [x] 2.1 Shape a Table through an agent: "A region for every customer", "A city cannot become a
  number", "Shaping a Table needs the right to build Tables".
- [x] 2.2 Make a Table for a file: "Suppliers get a Table of their own".
- [x] 2.3 Check a file before importing it: "A bad row is named".
- [x] 2.4 Import a checked file: "The checked file is imported", "A heading named differently goes
  where the agent says", "A file changed after its check is refused".
- [x] 2.5 Update the rows a file matches: "Acme Traders moves to Salem".
- [x] 2.6 Importing rows already there again is deliberate: "The same customers imported twice".
- [x] 2.7 A large update through an agent is confirmed: "Twenty-one changed cities wait for the
  count".
- [x] 2.8 Undo an import through an agent: "Undoing the agent's import".
- [x] 2.9 The agent's app knows which actions change data: "Removing a column and importing are
  flagged for approval".

## 3. What the scenarios leave out (mcp.test.ts)

- [x] 3.1 The tool list (seventeen) and each new tool's annotations (D5).
- [x] 3.2 Structure: `create_table` refuses a platform claim and a bad column the route's way;
  `change_column` sets choices and turns text into a link and back; `rename_column` keeps values;
  `remove_column` keeps values and names a column that is not there.
- [x] 3.3 Import: a CSV over 10,000 rows or 3 MB is refused before any request; a `columns`
  mapping naming a heading the file lacks or a column the Table lacks is refused; a skipped heading
  (`null`) is left out; a repeated key in the file fails its rows by row number; `add_anyway`
  adds the overlapping rows; `confirm_changes` with the right count runs; a structure change after
  the check needs a new check; the run records `file_name`; an import refused for permission
  writes nothing.
- [x] 3.4 `list_imports` gives one entry per run with its counts; `undo_import` with `dry_run`
  changes nothing.

## 4. Wrap-up

- [x] 4.1 README "Connect an agent": the new tools, CSV only, the check-then-run step.
- [x] 4.2 Checks: server tests touched, `test/mcp.test.ts`, `test/scenarios/agent-access.test.ts`,
  `test/system-written.test.ts`; both typechecks; `pnpm check:scenarios`, `pnpm check:specs`,
  `pnpm check:unarchived-changes`; server coverage within its caps.
- [x] 4.3 By hand over HTTP with a real token on `./init.sh`: create a Table, add a column, check a
  CSV with one bad row, fix it, import, query, change a column type, undo; a token without the
  right is refused. Transcript in the issue's hand-off.
- [x] 4.4 Sync the delta into `openspec/specs/agent-access/spec.md` and archive the change.

## Why

A custom screen in Featherbase is code today: it is drawn as a prototype, rebuilt in React, and reaches people only after CI, a merge and a deploy. Twice in November the rebuilt screen lost what had been agreed in the prototype, and each time users waited an hour or more with nothing real to react to (#1410). The owner wants to say "create a UI for this" in a meeting and see the screen inside Featherbase at once, and for that same screen to be the one that stays.

## What Changes

- A **page**: a screen saved as data and drawn by Featherbase inside its own shell, from Featherbase's own parts. Nothing is deployed to add or change one.
- A person who may build describes a page as a list of parts (a heading, a table with column bands and groups that open, a choice between views, an input, a button). Featherbase checks the description when it is saved and refuses a wrong one, naming every mistake.
- A page shows rows of Tables only as far as the person looking may read them, and may also carry sample rows, which Featherbase marks as sample.
- A page saves a row the way the row's own form does, with the same checks.
- A page is a draft, seen only by people who may build, until it is published.
- A published page is listed beside the Tables of its group.
- An agent connected for a person builds pages through the same door: it reads which parts exist, saves a page, and reads the refusal when it gets one wrong. A Table an agent makes can be placed in a group, beside its pages.

This is the first slice of the design in `docs/plans/runtime-pages-design.md`. An app with its own address, turning a page into a file in Git, and an app's own parts come in later changes.

## Capabilities

### New Capabilities

- `runtime-pages`: screens saved as data, checked when saved, drawn inside Featherbase, read and saved as the person looking.

### Modified Capabilities

None. The agent tools are new ones; no promise in `agent-access` changes.

## Impact

- **Server:** one new platform Table (`Page`) with its migration and a check that runs on save; two read routes (the pages a person may open, and one page); the Home Pages answer lists a group's pages.
- **MCP:** four new tools (`list_parts`, `list_pages`, `get_page`, `save_page`); `create_table` takes an optional `module`.
- **Shared:** the page checker and the catalog, used by the server and the web app.
- **Web:** a runtime that draws a page at `/featherbase/admin/page/<name>`, ten parts over `shop-floor`, one new shared component (a table with column bands and groups that open), and a "Pages" card on a Home Page.
- **Dependencies:** none added. A2UI's packages were tried in a throwaway proof and are not taken (ADR 0028).

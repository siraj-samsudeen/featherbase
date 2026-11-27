# ADR 0028: A runtime page is data in A2UI v1.0's shape, checked and drawn by Featherbase's own code

**Status:** Proposed · **Date:** 2026-11-27 · **Issue:** [#1410](https://github.com/siraj-samsudeen/featherbase/issues/1410) · **Change:** `openspec/changes/runtime-pages`

Proposed, not accepted: the owner agreed that a page is data over a catalog of parts and that it must
be drawable by the redesign. The choice of grammar and of who draws it was taken from the worker's
recommendation while he was away.

## Context and Problem Statement

A runtime page is a screen saved through the MCP and drawn inside Featherbase with nothing deployed.
The owner decided it is saved as data that names parts from a catalog, and that the same saved page
must later be drawable by the redesign, which renders HTML on the server and does not carry
`shop-floor` over. The saved form outlives the code that draws it, so its grammar is a durable
choice: which grammar, and whose code checks and draws it?

## Considered Options

- A2UI v1.0's grammar for the page body, checked and drawn by Featherbase's own code.
- A2UI v1.0's grammar, checked and drawn by A2UI's packages (`@a2ui/web_core`, `@a2ui/react`).
- A grammar of Featherbase's own, borrowing A2UI's ideas.
- A page saved as React source and compiled at runtime.

## Decision Outcome

Chosen: **A2UI v1.0's grammar for the body, with Featherbase's own checker and renderer.** A page's
parts are a flat list with ids; a part names its children by id or repeats one over an array; a
setting reads a value with `{"@path"}` or a named function with `{"@call"}`; a control fires
`action.event`. Around that body sits an envelope of Featherbase's own for what A2UI does not have:
named state, named data sources, and what each action means.

Only a subset is taken. `@checks`, `@accessibility`, `@metadata`, `@catalogId`, `functionCall`
actions and the agent messages are not drawn, and the checker refuses them, so a page cannot rely on
something that is not there.

### Consequences

- Good: the grammar and its rules for paths and scopes are written down by someone else and declared
  stable ("Breaking changes go into a future major version"), so Featherbase documents only its
  catalog and its envelope.
- Good: nothing in the grammar is React, so the redesign can draw the same saved pages with HTML
  parts.
- Good: no new dependency. The check is written in zod 4 beside the platform's other definitions and
  reports every wrong field at once, in the refusal shape the MCP already uses.
- Good: reversible. A saved page depends on the specification, never on a package, so A2UI's
  renderer can be adopted later, or dropped again, without changing a page.
- Bad: Featherbase owns about 300 lines that must follow A2UI's rules, and gains nothing from
  A2UI's releases.
- Bad: A2UI's own keys keep their spelling (`componentId`, `@path`) beside Featherbase's
  (`group_by`, `order_by`).

### Why not the others

- **A2UI's packages.** A throwaway proof drew a made-up screen through `@a2ui/react` 0.16.1 with
  three wrapped `shop-floor` components, so they work. They need zod 3 (`^3.25.76`) where this
  repository is on zod 4; they added 402 kB to the page's script; since 0.13 each part is drawn
  inside a custom element; they cannot draw on the server; their default check accepts an unknown
  part and a misspelled optional setting; and the packages are 0.x with breaking changes marked in
  0.11, 0.13, 0.15 and 0.16.
- **A grammar of our own.** It would have to be designed, documented and taught to every agent, for
  no gain over one that already exists and is stable.
- **React source.** No check can say what code will do before it shows, it needs a sandbox, and the
  redesign could not draw it.

## More Information

`docs/plans/runtime-pages-design.md` (sections 5 to 7) has the worked example, the subset table and
the evidence from A2UI's source at commit `36725ee` of `a2ui-project/a2ui`.

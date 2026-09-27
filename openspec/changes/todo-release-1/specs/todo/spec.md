# Release 1 — A shared Todo list

## Purpose

Build a small Todo app that keeps people's work safe and works through a browser or a documented HTTP API.

## ADDED Requirements

### Requirement: Manage todos without signing in

Anyone MUST be able to use the same shared list without an account:
- Create a Todo, initially open. Show success and clear the create input only after saving.
- Rename it without changing its identity or completion state.
- Complete, reopen, or deliberately delete it without affecting other Todos.
- Allow duplicate titles, but give each Todo its own stable identity.
- Prevent repeated activation during one pending submission from creating duplicates.

Deletion removes the Todo from all views and later reads. Confirmation dialogs and undo are optional.

#### Scenario: Everyday use
- **WHEN** I add `Buy milk`, rename it to `Buy oat milk`, complete it, reopen it, and delete it
- **THEN** each action succeeds on that same Todo, and other Todos stay unchanged.
- **WHEN** I deliberately add `Buy milk` twice and delete one
- **THEN** the other remains.

### Requirement: Keep titles valid

Creation and renaming MUST use the same rules in the browser and API:
- Trim whitespace at either end; keep case, internal spacing, and Unicode composition unchanged.
- Accept 1–200 Unicode code points after trimming; do not truncate. A code point is the counting unit, not a byte or UTF-16 unit.
- Reject non-text values, blank titles, and internal line breaks.
- On rejection, change nothing saved; explain the problem and keep the input for correction.
- Display titles as plain text, never executable markup.

For consistent results across languages, “whitespace” means Unicode White_Space; line breaks are U+000A, U+000D, U+0085, U+2028, and U+2029 remaining after trimming.

#### Scenario: Title examples
- **WHEN** I create or rename a Todo with these inputs
- **THEN** these results apply:

| Input | Result |
| --- | --- |
| `  Buy  milk  ` | Save `Buy  milk`, keeping the double internal space. |
| Blank, whitespace-only, 201 code points, or an internal line break | Reject; keep my input and existing data. |
| Exactly 1 or 200 code points, including emoji outside the basic Unicode range | Accept. |
| `<script>alert(1)</script>` | Display literally; execute nothing. |

### Requirement: Filter the list

The app MUST offer All, Open, and Completed, initially showing All. Filtering never changes data. Show the selected filter and completion state without relying on color. Saved changes immediately update membership in the current view. Distinguish an empty result from loading or failure. List order and remembering filters across reloads are optional.

#### Scenario: Mixed and empty results
- **WHEN** `Buy milk` is open and `Send invoice` is completed
- **THEN** All shows both; Open shows only `Buy milk`; Completed shows only `Send invoice`.
- **WHEN** I complete `Buy milk` while viewing Open
- **THEN** the view says there are no open Todos, and Completed contains both.

### Requirement: Keep saved work in PostgreSQL

PostgreSQL MUST hold the saved data. Confirm success only after saving durably. Subsequent reads must show that change unless someone has changed it again. Reloads, independent browser sessions, and server restarts against the same database must preserve identities, titles, completion states, and deletions. Do not depend on browser storage or silently switch to temporary storage when PostgreSQL is unavailable.

#### Scenario: Return later
- **WHEN** I rename one Todo, complete another, delete a third, then reload, open another browser session, and restart the server
- **THEN** all saved changes remain, including the deletion.

### Requirement: Recover from failures without losing input

The app MUST show pending work and offer recovery without a full-page reload:
- Failed creation or renaming keeps the entered text and usable controls.
- Failed completion, reopening, or deletion keeps or restores the last confirmed state.
- Failed loading shows an error and retry, not a false empty list.
- If the server may have saved a request but its reply was lost, explain the uncertainty and check the saved outcome before risking a duplicate creation.
- Database failures never appear as successful saves.

Offline use and keeping drafts after closing the page are not required.

#### Scenario: Retry safely
- **WHEN** a create or rename request fails before reaching the server
- **THEN** I can retry after connectivity returns without retyping or creating duplicates.
- **WHEN** a read or other change fails
- **THEN** I see an error, not false success, and can retry.
- **WHEN** creation succeeds but its reply is lost
- **THEN** recovery finds the saved outcome without creating that Todo again.

### Requirement: Never silently overwrite another session's changes

A rename, completion, reopening, or deletion MUST be rejected if the Todo changed since the user last saw it. This applies even to changes to different fields, or a value changed away and back. Two competing writes based on the same observation cannot both succeed. API requests must include the documented proof of which version they saw; missing proof is rejected. The implementation chooses how that proof works.

Explain the conflict, preserve any typed title, and let the user review the latest version before deliberately retrying or discarding their draft. Live updates are optional and must not erase unsaved input.

#### Scenario: Two people edit
- **WHEN** A and B both see `Buy milk`, A saves `Buy oat milk`, and B tries to save `Buy bread`
- **THEN** reject B's stale save, keep A's saved title and B's draft, and let B review the latest version before saving again.
- **WHEN** B instead tries to complete, reopen, or delete the stale Todo
- **THEN** reject that change too, leaving the saved Todo untouched.

### Requirement: Handle Todos deleted elsewhere

Acting on a Todo deleted in another session MUST explain that it no longer exists, update the list, and preserve any typed rename for recovery. Never recreate it or affect another Todo. Repeated deletion reports “absent/already deleted,” not a new successful deletion. The API must distinguish missing records from invalid input and conflicts with existing records.

#### Scenario: Deleted while editing
- **WHEN** A deletes a Todo while B is editing it, and B tries to save or otherwise change it
- **THEN** B sees that it is gone, can still recover the typed title, and does not resurrect the Todo.

### Requirement: Work with keyboards, screen readers, and small screens

All flows MUST meet applicable WCAG 2.2 AA requirements: labelled controls with accessible roles/states, errors associated with inputs, and screen-reader announcements for pending work, success, conflicts, and failures. Every action must work by keyboard, with visible focus, logical order, no traps, and sensible focus after an item/editor disappears. Do not rely only on color or hover.

Keep content and controls usable from 320–1440 CSS pixels wide and at 200% text zoom, including long titles: no overlap, clipped actions, or page-wide horizontal scrolling.

#### Scenario: Accessible use
- **WHEN** I perform the Todo lifecycle and filtering using only a keyboard
- **THEN** every action works and focus stays visible and useful, including after deletion.
- **WHEN** I use a screen reader and encounter invalid input or a stale edit
- **THEN** I can identify the Todo, controls, selected filter, completion state, errors, and outcomes without hunting for focus; my input remains available.
- **WHEN** I use 1280×800, 390×844, or 320-pixel-wide layouts, or enlarge text to 200%
- **THEN** I can still use every action, even with a 200-code-point title.

### Requirement: Provide a discoverable JSON HTTP API

All Todo operations MUST be usable with an ordinary HTTP client, without application source or a generated client. Publish an OpenAPI 3.1 JSON document over HTTP and identify its location in the run instructions. It must describe operations, inputs, record identity/title/state, concurrency proof, responses, and distinguishable machine-readable errors. Routes, methods, response layouts, and libraries remain implementation choices.

The server must enforce the title, filtering, and concurrency rules itself. Responses must match the published schemas and appropriate HTTP success/error codes. Reject malformed JSON, invalid types/titles/filters, and missing concurrency proof as documented client errors, without changing data or crashing. An unknown filter must not silently mean All.

#### Scenario: Use the API without the UI
- **WHEN** I fetch the API document
- **THEN** I can use it to list, read, create, rename, complete, reopen, delete, and filter Todos, including handling conflicts and missing records.
- **WHEN** I send invalid requests directly, bypassing browser checks
- **THEN** they fail as documented, leave data unchanged, and valid requests still work.

### Requirement: Migrate without destroying data

Provide documented, non-interactive migrations that MUST:
- Initialize an empty PostgreSQL database and durably track applied changes.
- Be safe to run again without changing existing Todos or duplicating them.
- Report failures honestly; never mark unfinished work applied. After the cause is fixed, retry must complete without deleting existing data.
- Handle simultaneous runs safely, or explicitly refuse one without corruption.

Startup/restart must not reset, overwrite with seed data, or drop existing data. Do not report ready when the required schema is unavailable. Document migration and production-run commands separately from any disposable development reset; reset is never needed for normal operation. Release-2 rollout and rollback are addressed at Gate 5.

#### Scenario: Initialize, repeat, and recover
- **WHEN** I initialize the database, add Todos, and rerun migrations
- **THEN** their identities, titles, states, and count remain unchanged.
- **WHEN** permissions or an interruption prevent migration completion
- **THEN** it reports failure; fixing the cause and retrying completes safely without losing data.
- **WHEN** two migrations run together
- **THEN** they safely complete or one clearly refuses, without corrupting data or migration history.

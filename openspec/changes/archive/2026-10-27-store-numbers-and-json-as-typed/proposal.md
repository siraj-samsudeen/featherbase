## Why

A whole number saved into a table came back as text (`"13"`), and JSON typed into a form was stored as one long piece of text instead of the data it describes. Anything that reads those values afterwards, such as a report, a script, a filter or an app, got the wrong kind of value. Fixes #541 and #545, and #533, where an identifier system's unchanged retention period was reported as changed because it came back as text.

## What Changes

- A whole number reads back as a number, from local tables and from tables connected to another database.
- JSON typed into a form's JSON box is saved as the data it describes. Text that isn't JSON is refused at that field with a message, and nothing is saved.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: a number column gives back a number; a JSON column holds the data typed into it.

## Impact

Server database client settings and the Admin form's save step. No schema change, no migration, no new endpoint. Amounts (Currency) still come back as exact text, as before.

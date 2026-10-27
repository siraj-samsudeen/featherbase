# Tasks

## 1. Links to a connected table (#535)

- [x] 1.1 Flip the pinned test "a local row can refer to a bound row" to a plain test, and add one for a link to a missing connected row.
- [x] 1.2 The save-time link check asks the data source for a connected target instead of a local table.

## 2. Allowed tables checked before any is connected (#518)

- [x] 2.1 A test that asks for two allowed tables and one refused one, and expects a refusal with nothing connected.
- [x] 2.2 Check every requested table against the allowed list before connecting any.

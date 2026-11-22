# Database

How Tables, rows and Featherbase's own records are stored.

## Acceptance criteria

Proposed by Claude while building the journey. Not yet agreed by Siraj.

1. Tables and their rows are still there after Featherbase is stopped and started again.

## Decided

**Runtime and framework.** Bun, ElysiaJS, Postgres 18.6

**Database access.** Drizzle on Bun's built-in Postgres driver; `postgres.js` if that misbehaves on 18.6, checked at setup

**How a Table and its rows are stored.** A plain Postgres table per Table, one real column per Column, readable names (`employees`, `date_of_joining`). People's Tables go in schema `main` by default; later a person picks the schema, or it is the app's name. Featherbase's own tables go in schema `featherbase`. `featherbase`, `main`, and the names Postgres reserves are refused as app or schema names. Featherbase's own columns start with an underscore. In this build every Table has three: `_id`, `_created_at`, `_updated_at`. Who created or changed a row is added when people sign in; adding an empty column later is instant in Postgres. Delete really removes the row in this build. A raw row's "written to" link is left as it is when its row is deleted. `_id` is a time-ordered unique id made by Postgres. Required and unique are real database rules on the key. Number is one exact decimal type. Every internal link to a Table or Column uses its `_id`, never its name, so a Table can later be renamed or moved to another schema without breaking anything inside

**Migrations for Featherbase's own tables.** Drizzle's migration tool: tables described in code, one generated SQL file per change, file names by timestamp (to confirm at setup), pointed at schema `featherbase` only. Tables people make are created by the app, not by migrations

**The shape of a Table is a contract.** The owner's change-data-capture package reads these tables and loads
them into MotherDuck, so a renamed table or Column changes the warehouse. That is why a Table is a plain
Postgres table with one real column per Column.

# Journey 1: Featherbase opens

The first thing built, before any feature.

A smoke journey, built before any feature. It exists to force the tooling into place: the runtime, the
database and its migrations, the harness, the browser test, the recording and the checks on every push.

1. On a fresh install, a person opens Featherbase.
2. The home page says there is nothing here yet, and offers "Import data".
3. Under "Your Tables" it says there are none.

The page reads its list of Tables from the database, so an empty database with migrations applied is part of
what the journey proves.

**Also part of this build:** the test command that says plainly when coverage is not met; the checks on every
push; and a check that fails when a file sits outside the map in `AGENTS.md`.

**Confirm while setting up, and record the answer in `features/foundations/database/database.md`:** Bun's own
Postgres driver against 18.6; timestamp names for migration files; the CSV library on Bun; Postgres 18's
time-ordered ids.

**The harness** is `feather-testing-elysia`, version 0.1, unpublished, on the `v0.1` branch of its own
repository. It installs its two foundations from bundled files and asks for `feather-testing-postgres`
^0.3.0, while 0.4.0 is published. It needs a release, in its own repository, before the checks on every push
can install it.

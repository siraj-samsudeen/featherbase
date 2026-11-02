# ADR 0018: A pasted warehouse token is stored encrypted in Featherbase's database

**Status:** Accepted · **Date:** 2026-11-02 · **Issue:** [#772](https://github.com/siraj-samsudeen/featherbase/issues/772)

## Context and Problem Statement

Featherbase has kept every secret outside its database: a data source names the deployment
variable that holds its connection, and an app's secrets are deployment variables
(`app-settings.ts`). That keeps secrets out of database dumps, but it means only someone with
server access can connect a warehouse. The owner wants a System Manager to connect a MotherDuck
warehouse entirely in the app, pasting its token (owner, 02-Nov-2026).

## Considered Options

- Keep tokens in deployment variables (today).
- Store the pasted token in Featherbase's database, encrypted with one master key held as a
  deployment variable.
- Store the pasted token in plain text.

## Decision Outcome

Chosen: **encrypted in the database.** A pasted MotherDuck token is encrypted with AES-256-GCM
under `SECRET_STORE_KEY`, a deployment variable that is required outside development, has a fixed
development default, and must differ across environments (the same rules as `JWT_SECRET`). The
server decrypts a token only to open a connection; it never returns, logs or echoes one, and shows
only its last four characters. Deployment variables remain the place for every other secret.

### Consequences

- Good: the job needs no server access; a token can be replaced in the app without a restart.
- Good: a database dump or backup holds only ciphertext.
- Bad: anyone holding both the database and the master key holds the tokens; the master key must
  be guarded like `JWT_SECRET`.
- Bad: losing the master key means pasting each token again; there is no key rotation tool yet.
- Plain text was rejected outright: read access to the database would leak every token.

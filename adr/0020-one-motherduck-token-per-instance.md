# ADR 0020: One MotherDuck token per instance, and a warehouse is only ever read

**Status:** Accepted · **Date:** 2026-11-05 · **Supersedes:** [ADR 0018](0018-pasted-warehouse-tokens-encrypted-in-the-database.md) · **Issue:** [#969](https://github.com/siraj-samsudeen/featherbase/issues/969)

## Context and Problem Statement

An instance reached MotherDuck in three ways: a connection variable that held only `md:`, a tick
saying its token was a read-scaling one, and a token pasted for each connected warehouse, stored
encrypted under a master key. The owner decided on 05-Nov-2026 that one token serves the whole of
Featherbase and the read-scaling concept goes away. That token may have write rights.

## Considered Options

- Keep a stored token per source (ADR 0018).
- One deployment variable, with sessions in MotherDuck's default mode, trusting that the platform's
  SQL only reads.
- One deployment variable, with sessions in single-attach mode and every database attached read-only.

## Decision Outcome

Chosen: **one deployment variable, `MOTHERDUCK_TOKEN`, with read-only single-attach sessions.** A
source names the databases it reads; each session looks up their addresses from what the token can
read and attaches only those, read-only. The attach statement has no writable form. The engine has
no write path, a source cannot be set to read-write, and a DuckDB source refuses a MotherDuck address,
so there is no second way in. Deployment variables are again the only place a secret lives, so the
encrypted token store and `SECRET_STORE_KEY` are removed.

### Consequences

- Good: one secret to set and rotate, and no token in the database or in any admin's hands.
- Good: read-only comes from how the session is opened, with no flag to get wrong.
- Bad: changing the token needs a variable change and a restart, not a screen.
- Bad: sources cannot read different accounts. The token must be able to read every database any
  source names; a share created hidden is not listed, so it cannot be named until it is shown.
- Bad: the platform's own fixed reads (the leaver check) still open MotherDuck's default mode, with the same
  token. They run only the platform's SQL, and no connected table or dataset reaches them.

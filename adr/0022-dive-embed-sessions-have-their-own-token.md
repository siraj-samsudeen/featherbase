# ADR 0022: Dive embed sessions have their own token

**Status:** Accepted · **Date:** 2026-11-10 · **Supersedes in part:** [ADR 0020](0020-one-motherduck-token-per-instance.md) (one MotherDuck token per instance) · **Issue:** [#1139](https://github.com/siraj-samsudeen/featherbase/issues/1139)

## Context and Problem Statement

Under ADR 0020, `MOTHERDUCK_TOKEN` was the one MotherDuck token an instance had, and Dash's Dive
embed used it too. Production then moved that token to a shares-only account, so the warehouse
can't be written to whatever Featherbase does. MotherDuck lets only an account allowed to create
Dive embed sessions call `POST /v1/dives/{id}/embed-session`, so every embed answered HTTP 403 and
the live report never opened. One token can't be both the read-only warehouse account and the one
that may create embed sessions.

## Considered Options

- Give the warehouse token back the right to create embed sessions (the Admin preset role).
- A second token, declared by Dash and used only for the embed-session call.
- A second token, with a fallback to `MOTHERDUCK_TOKEN` when it isn't set.

## Decision Outcome

Chosen by the owner on 10-Nov-2026: **a second token.** `MOTHERDUCK_TOKEN` stays the read-only
account every read uses. Dash declares `MOTHERDUCK_EMBED_TOKEN` as an optional secret that only
its two reads opening a Dive need (`needs` in the manifest), so the platform hands it to nothing
else, and the embed-session call sends only it. Its account must be allowed to create Dive embed
sessions. The `username` service account still runs the Dive and needs only access to its data.

There is no fallback. A secret the manifest marks optional is either needed by a read, which then
refuses while it is unset, or never handed to that read at all. A fallback would also hide the
missing setup on production behind the same quick view the 403 produced. An instance without the
embed token says the two embed reads are not set up and shows the quick view.

### Consequences

- Good: the warehouse token can stay read-only, and the token with wider rights reaches only the
  one call that needs them.
- Bad: two MotherDuck variables to set and rotate. Dev and every other instance that opens a Dive
  need `MOTHERDUCK_EMBED_TOKEN` set, or they show the quick view only.
- ADR 0020's read-only sessions are unchanged: every read of the warehouse still uses
  `MOTHERDUCK_TOKEN`, attached read-only.

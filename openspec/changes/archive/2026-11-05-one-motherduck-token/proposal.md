## Why

An instance needs several settings to reach one warehouse: a connection variable that only says `md:`, a tick saying its token is a read-scaling one, and a separate token pasted for each connected warehouse. The owner decided on 05-Nov-2026 that there is one token for the whole of Featherbase, set once for the instance, and that the read-scaling concept goes away. People connecting a warehouse should not need to handle a token at all.

## What Changes

- **BREAKING** Everything that reaches MotherDuck uses one deployment variable, `MOTHERDUCK_TOKEN`: app datasets, the Dive embed, connected tables and copied tables.
- **BREAKING** `MOTHERDUCK_URL` goes away. A DuckDB source is a local file only and refuses a MotherDuck address.
- **BREAKING** The read-scaling field and its checks go away.
- **BREAKING** No token is pasted or stored for a source. The token-replacement screen, the encrypted token store and `SECRET_STORE_KEY` go away.
- Choosing which databases a source reads stays, against what the instance's token can read.
- A MotherDuck source is view-only in code, always, with no setting, even when the token has write rights. Every session attaches only the chosen databases, read-only.
- A migration moves an existing MotherDuck source onto the new shape; the settings file names the databases the Feather Dash source reads.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`: connecting a warehouse uses the instance's token; a warehouse is only ever read; the token-pasting and token-replacing promises are removed.
- `instance-settings`: the settings file can bring back a MotherDuck source, with the databases it reads.

## Impact

- Server: `sources/` (driver, registry, MotherDuck session), MotherDuck actions, app setup checks, release preflight, variable registry; `secret-store.ts` is deleted.
- Web: the connect page and the source page lose their token fields.
- Data: one migration converts existing MotherDuck sources and drops the read-scaling field, the last-four field and the encrypted token table.
- Hosted variables change on each environment; the PR lists them. Non-MotherDuck sources are unchanged.

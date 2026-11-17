## Why

After #1224 named who gave a role, the rest of the Admin still showed "Unnamed person" to a reader without Person read: who made, changed or retired a row, and who archived a Table. Siraj chose to name them too, under the same rule: you can see who did what you can see. The access page's "everyone who signs in holds it (System Settings)" also puzzled a non-technical reader.

## What Changes

- Who made, last changed or retired a row, and who archived a Table, is named to anyone who may read that row or Table, without Person read. Any other id stays unnamed.
- The access page says a role everyone holds is one "everyone who signs in has".

## Capabilities

### Modified Capabilities

- `actor-names`: covers who made, changed or retired a row, and who archived a Table.
- `permissions-and-roles`: plainer words for a role everyone holds.

## Impact

- Platform: `POST /api/people/actor_names` (`actorNamesOn` in `actor-names.ts`).
- Web: `PrincipalName` / `ShownName` take `actorOf`; used by list actor columns, the record page's created/updated line, the retired notice, the archived banner and import conflicts.

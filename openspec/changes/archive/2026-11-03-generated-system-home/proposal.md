## Why

System misses newer platform Tables, including Sign In Method. People should find every readable standalone system Table without someone maintaining navigation links.

## What Changes

- Generate System membership whenever Home Pages are fetched, excluding sub-tables and retaining Settings Tables.
- Keep existing ordered card groups as optional placement hints, with unplaced Tables under Platform.
- Show effective Table labels after permission checks; preserve canonical destinations, other Home Pages and legacy shortcuts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dashboards-and-home-pages`: System discovers eligible Tables automatically while other Home Pages remain curated.

## Impact

Server Home Pages response and its existing HTTP/browser tests. No schema, migration, permission grant, route policy or choice-label contract changes. Implements #831's six-point checklist; unmerged #821/#826 remain separately owned.

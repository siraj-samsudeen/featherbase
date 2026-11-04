## Why

#906: a builder cannot create a Table called "Site". It is refused as a clash
with platform storage. A client wants Site as a business Table (a physical
place that groups several plants) and uses "Site Master" in the meantime.

The refusal protects against a clash that no longer exists. When it was added
(#296/#298), a builder's Table and the platform's record of the sites an
instance hosts lived side by side, so a Table "Site" would have landed on that
record. Builders' Tables have since moved into the platform's own space, so a
Table "Site" and the host record are two separate things.

## What Changes

- A Table named "Site" can be built, like any other name nobody has taken.
- The host record of sites is left exactly as it was.
- The general rule stays: a name already taken by a Table or by the
  platform's own storage is still refused.
- Out of scope: moving or renaming the host record (#906 option 2), which
  costs a migration for a record nothing reads yet.

## Capabilities

### Modified Capabilities

- `tables-and-fields`: building a Table named Site succeeds.

## Impact

- `apps/server/src/table-engine.ts` (`createTable`): the special case for
  `site` is removed from the clash check; the check for anything already in
  the platform schema under that name stays.
- `apps/server/test/ddl.test.ts`: a Table "Site" is created and used, and
  `public.site` is unchanged.
- No migration: existing instances need nothing to start using the name.

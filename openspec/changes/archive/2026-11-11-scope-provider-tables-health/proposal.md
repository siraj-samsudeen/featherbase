## Why

Dash's scope provider reads core Tables on every request for someone's scope and refuses
everyone when one read fails (rama_dw #4588). Buyer reach adds Merchandise Assignment and
Subcategory's merchandise links, which production has and dev and staging did not, because a
client's core Tables reach an instance outside platform code. An instance lacking one learned
of it only when every reader lost access.

## What Changes

- Instance health gains one check for the enabled scope provider: every Table its manifest's
  `scopeProvider.tables` lists, and every column it declares reading from them under
  `baseTables.read`, exists on the instance. A failing check is an error naming each missing
  Table and column; the release step prints it like every check.

## Impact

- `apps/server/src/instance-health.ts`; `apps/server/test/instance-health.test.ts`.

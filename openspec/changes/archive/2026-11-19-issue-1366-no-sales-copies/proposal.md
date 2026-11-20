## Why

The owner decided on 19-Nov-2026 (#1366) that a report opens its Dive and nothing else: a different
layout standing in for the Dive is not wanted. Dash's four-hourly copy of the sales figures into
Featherbase fed only that stand-in, at about 1.1 million database row writes and 87 MB a day, so it goes
with it. The old platform Sales Target page, which Dash replaced, is retired too. Who opened which report
was recorded only when the stand-in answered; now every report's opening is recorded.

## What Changes

- Dash copies no sales figures into Featherbase. The Sales Target quick view goes, with its "figures
  haven't arrived" and "being prepared" notices. A report whose Dive can't open says it couldn't open,
  with Try again.
- A report whose Dive has its own pickers opens on the reader's first store A–Z.
- Every report a reader opens is recorded in the Access Log once, whichever report it is.
- The old Sales Target page and its cached copy of the figures are retired.

## Capabilities

### New Capabilities

### Modified Capabilities

- `dash-reports`: a report that can't open says so (no quick view); every report opened is recorded.
- `sales-target-report`: the requirements about the cached copy, its refreshes and its stand-in table are
  removed; the Access Log and failure requirements no longer mention the cache.
- `permissions-and-roles`: the report-only screen of the old Sales Target page is gone.

## Impact

Dash 0.13.44 (step `no_sales_copies`). Production keeps the old copies' rows until the manager deletes
them after the release; nothing reads them.

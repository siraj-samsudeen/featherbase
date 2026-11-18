## Why

Run on staging (a copy of production, about 9,200 people), two defects showed (#1277). Who Would Gain Or Lose Access asked the database person by person and ran past Railway's five-minute limit, so the page failed. And Owner Director, which holds View Reports at reach All and is meant as "the whole company and every report", opened Dash at every store with no report: reports came only from grants.

## What Changes

- Who Would Gain Or Lose Access reads each Table once for the whole company, and every person's platform roles in one read, then compares each person in memory by the same code Explain runs for one person. Its result is unchanged.
- A business role holding View Reports at reach All (Owner Director, or any role an admin gives that permission) is offered every report the instance has, at every store, live and in the comparison. Explain says why in plain words: "Every report, through Owner Director". The comparison says "Would get every report, through Owner Director".
- Platform: an app may ask the roles of many people at once (`people.rolesOfMany`), each exactly as `rolesOf` gives it.

## Capabilities

### New Capabilities

### Modified Capabilities

- `business-roles`: a role viewing every report; the comparison reads the company once.

## Impact

- Dash 0.13.32, with an empty version step: no Table, role or read changes.
- Platform: `people.rolesOfMany` in the runtime action context.

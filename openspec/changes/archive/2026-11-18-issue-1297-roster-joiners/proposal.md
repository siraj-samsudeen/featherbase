## Why

The roster was loaded once (07-Nov-2026) and nothing adds to it, so everyone who joined afterwards has no roster row, no person, no sign-in link and no job (#1297, follows #1286). The owner approved adding them from the same HR feed on 18-Nov-2026.

## What Changes

- When a roster names `joiners`, each roster run, after the status sync and from the same feed read, adds a row for every record the feed shows plainly current (active, not a leaver by the shared rule, on the payroll or a recent joiner) that no row holds in any status, and, when the settings name a job Table, that person's primary job: the site of their store, the job by a whole-designation match (another default off a store), their section and manager where the Tables say so.
- Every Table, column, job title and code template comes from the settings; the platform names none. A record with no code, no name or a code another row has is held and counted; a joiner with no site gets the row but no job.
- More additions than one in twenty current rows (at least ten) adds none, refuses the job and alerts; `cli roster:link --apply --accept-joiners <n>` lifts it for exactly that count. A stale or empty feed adds nobody.
- Each row is a save by the roster link (Activity), and the same run's link pass makes their person and link.
- Dash names its joiners block in the instance settings, with the designation-to-job mapping its first load used.

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: the roster run adds new joiners and their jobs.

## Impact

- Platform: `roster-joiners.ts` (new), `roster-link.ts`, `roster-status.ts` (one feed read per run), `leaver-check.ts` (the feed carries what a joiner is built from), the `link_roster` job, `cli roster:link`.
- Dash instance settings: `joiners`.

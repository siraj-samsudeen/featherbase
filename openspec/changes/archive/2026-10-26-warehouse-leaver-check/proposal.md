# Proposal

## Why

StyleHR's sign-in answer says nothing about whether the person still works here. Someone who has left keeps signing in to Featherbase until HR also blocks them in StyleHR, which often does not happen. The warehouse already holds each StyleHR employee record with its exit date, status and payroll membership (data-warehouse #4336, approved by Siraj on 24-Oct-2026).

## What Changes

- A daily scheduled check reads the StyleHR employee record in the warehouse and disables every linked person who has left: an exit date that has passed, an inactive status, or not being on the latest payroll (people who joined in the last 62 days are spared the payroll test).
- It only ever disables. System Managers and the Administrator are reported, never disabled.
- It refuses and disables nobody when the warehouse's StyleHR data is more than a day behind, when it returns no records, or when a run would disable more than 5% of linked people (at least 2 may always go).
- Each disabled person gets an activity row with the reason; System Managers get one summary email per run that changed something or refused.
- It ships switched off. `cli leavers:check` gives a dry run with counts only; `--apply --accept <n>` lets an operator act on a large but genuine batch of exactly n people.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: a person the StyleHR record shows has left is disabled by a daily check.

## Impact

New `leaver-check.ts`, job `disable_leavers`, migration 0119 (its Scheduled Job row, off), CLI `leavers:check`. The MotherDuck reader the sales-target dataset used moves to a shared module. Reads `gold.hr.employee`, `gold.hr.employee_exit` and `gold.hr.attendance` with the server's existing `MOTHERDUCK_TOKEN`; no new credential.

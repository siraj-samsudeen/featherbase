# Tasks

## 1. Scope from the roster

- [x] 1.1 Add failing tests: a TL sees their whole Section; a roster Section reaches every aliased merchandise Section; only each Section's current roster row counts (superseded and future-dated rows derive nothing, a handover leaves other Sections alone); a DM sees every Section they manage; without a DM code column a manager derives nothing.
- [x] 1.2 Derive team_leader and department_manager scope from Section Ownership, Section Name Alias and Section Merchandise Map; report `sections`, `section_by_material_group` and `scope_basis`.

## 2. Month to date

- [x] 2.1 Add failing tests for IST month rollover, the `SALES_TARGET_TODAY` pin and its validation; pin the existing fixtures to 17-Sep-2026 so their expectations keep their meaning.
- [x] 2.2 Replace the fixed period with `currentPeriod()` in the identity, embed-session, report and dataset paths.
- [x] 2.3 Add a failing test that a September snapshot is not a hit on 01-Oct and that the first October build activates; make the dataset version carry the period.

## 3. Section grouping

- [x] 3.1 Add a failing test for Section ordering and subtotals in the report; compute them server-side.
- [x] 3.2 Send `section_by_material_group` in the embed starting state; group the report page by Section and show the scope basis.

## 4. Review fixes

- [x] 4.1 Validate store and material group codes before they reach query text; drop and log a malformed map cell.
- [x] 4.2 Parse roster dates only when they are ISO days; compare Section names trimmed and case-folded.
- [x] 4.3 Say "no data yet" on the 1st before the morning load, and fail that refresh with the reason.
- [x] 4.4 Show missing-actual counts on each Section subtotal (report page and Dive version 3).
- [x] 4.5 Land a report viewer on the report after Google sign-in, as password sign-in already did.

## 5. Verification

- [x] 5.1 Run server and web typecheck, the sales-target and dataset-snapshot suites, the full server suite, `pnpm check:specs` and `git diff --check`; exercise the real ATK roster against live MotherDuck on a local instance.

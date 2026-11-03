# Preserve first-run deep links

## Why

Issue #844: a pending first-run offer can replace a valid new-row deep link after a full document reload. The existing instance-health contract already promises that deep links are never taken over.

## What Changes

- Reproduce a pending offer on a new-row deep link while the real health response is delayed.
- Restrict automatic setup offers to Admin home landings, preserving the one-shot offer and authorization checks.
- Verify the original 375px journey and desktop without changing routes, layout, CSV or metadata behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This restores `instance-health` → “First-run System Manager setup” → “A deep link is not taken over”; no promise changes. Delta specs are deliberately skipped.

## Impact

The Admin shell's setup-offer hook and public component/browser regressions. No database, API, dependency or route changes. Based only on current `origin/main` at 422babb8, not the manager's older local main or unmerged workers.

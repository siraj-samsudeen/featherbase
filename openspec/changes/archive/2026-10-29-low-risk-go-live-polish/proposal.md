# Proposal

## Why

Small Admin defects make routine work harder on phones, hide useful names, and make saved views difficult to discover. Finish the contained go-live fixes without changing permissions, app contracts, or the larger product plans.

## What Changes

- Stabilise the overlapping snapshot test (#618), which failed in CI; this does not change production behaviour.
- Correct no-access branding (#552), JSON history display (#590), relationship-map names and navigation encoding (#593), and person-valued row titles (#644).
- Fix the import wizard's reported layout/wording defects (#579) and make all relationship-map groups discoverable on a phone (#592).
- Offer saving filters immediately, retaining the existing repeat-use nudge (#522; owner decision on #566).
- Finish #546's visible navigation defects: reserve room for frequent destinations and open the final Explore pane's rows in Peek. Item 1 is already merged in #594. Items 2–3 are not pursued under the owner's usage-first triage decision on 28-Oct-2026; #613's coverage-only request is closed as not planned.
- Explain that switching a scheduled job on queues a run immediately (#584), without changing the scheduler.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `saved-views`: make saving filters available on first use, not only after a nudge.
- `search-and-explore`: keep frequently used destinations available alongside recent ones, and specify the final-pane click.

The other items repair existing promises or tests; they do not require new behavioural requirements. Preserve current capability paths and coordinate any later path adoption with other active changes rather than moving unrelated specs in this round.

## Impact

Generic Admin components and pages, existing row-title resolution, and focused server/web tests. No new dependency, app contract, scope model, approval model, deployment, or trial-data rewrite. The four security/concurrency issues (#680, #575, #572, #599) have a separately owned change and are not part of this one.

# Design

## Context

See proposal.md for scope. The existing UI owns these behaviours: ListView's
SavedViewsBar only renders its save form after a repeat-use nudge; AdminLayout
fills all five recall slots with recent entries before considering frequent
ones; RelationMap renders a fixed minimum-width SVG and raw trail IDs.
ActivityTimeline delegates to formatValue but falls back to String for values.
Shared rowDisplayTitle returns a title column's raw value, including principal
references; the server's rowTitles read already applies the caller's scope and
readable-column restrictions.

NoAccessPage uses TopBar without a person-specific naming context. Explore's
last pane has no useful downstream selection but still gives rows the same
selection handler as intermediate panes. The import wizard's issue includes
a sticky-bar observation that needs checking at a real scroll position, not
only in a full-page capture.

## Goals / Non-Goals

**Goals:** reuse existing name resolution, controls, save operations and
query boundaries; deliver independent small fixes with regression tests.

**Non-Goals:** change access rules, add app contracts, repair historic trial
data, add a new navigation architecture, or touch the separately owned
security/concurrency batch. No mass spec-folder migration.

## Decisions

1. **Preserve source-of-truth boundaries.** Resolve principal-valued titles
   through existing permission-aware row-title/people facilities. Do not
   teach the pure shared title helper to make requests or add a second title
   cache. Test a person-valued title, an ordinary title and an unreadable row.
2. **One save path for saved views.** The always-available action and existing
   repeat-use nudge share the same saving logic. Retain private-by-default
   views and existing sharing rules; do not introduce in-place renaming.
3. **Phone map stays readable.** Keep the desktop SVG and use a narrow-layout
   arrangement that exposes the centre, forward and back-reference groups
   without shrinking labels below design-system sizes. A simply scaled-down
   700px drawing is not sufficient. Navigation uses the existing row targets.
4. **Usage-first scope.** The owner excluded review-derived edge-case work
   on 28-Oct-2026. Leave #546's deleted-table permission and repeat-deletion
   cases alone; fix its observed navigation defects. #613 is coverage-only
   and closed as not planned. Do not add tests for it in this round.
5. **State-based test synchronization.** #618's first 100ms sleep assumes a
   fetch has begun. Replace that assumption with an explicit fetch-start
   signal; retain the proof that a second refresh cannot fetch before the
   first activation completes. Ensure gates release on assertion failure.

## UI acceptance checklist

Implement against the existing Shop Floor components. Record this checklist
on the matching issues before building; use a separate verifier at 1280px and
375px in light and dark themes before owner acceptance.

1. #552: no-access Admin-address bar and browser tab read **Featherbase**;
   usable Admin screens retain **Featherbase Admin**. Account/sign-out remain.
2. #590: JSON before/after values show meaningful JSON, never
   **[object Object]**; long nested values wrap without sideways page scroll.
3. #593: map trail stops use row titles; Back restores the correct row; reload
   and copied links preserve the trail without a second JSON quoting layer.
4. #592: all map groups and their counts are discoverable at 375px without
   sideways scrolling. Empty and multiple-link maps retain usable controls.
5. #579: saved-work status is not repeated; the sheet summary and target
   picker remain readable; the table-count phrase stays together; at the
   bottom of a real scroll the import bar does not cover revert/results.
6. #644: a person-valued title shows the person's name in list recents,
   sidebar, breadcrumb and row heading. Ordinary titles and Service Account
   titles remain correct; unreadable names are not newly disclosed.
7. #522: a filtered list offers **Save view** on first use. It opens a named
   field **View name**, **Save** and **Cancel** using existing inline controls.
   Save persists the exact filters, surfaces failures, and the view reopens
   after reload. An unfiltered list does not offer an empty view; the nudge
   remains available without creating duplicate forms.
8. #546: when distinct frequent destinations exist, at most three recent
   destinations and two frequent destinations fill the five recall slots;
   no duplicates. With no distinct frequent destinations recent entries may
   use the spare slots. Clicking or keyboard-activating a last-pane Explore
   row opens Peek; earlier-pane clicks still narrow the chain, and closing
   Peek keeps the chain unchanged.
9. #584: Jobs explains **Switching a job on queues a run immediately.**
   The explanation remains readable at both widths and themes; scheduler
   behavior is unchanged.

## Risks / Trade-offs

- Shared title fixes can reveal unreadable data → preserve existing scope and
  column filtering and test a restricted-title control.
- Test-only timing changes can disguise missing exclusion → prove a bad
  implementation fails, not merely that the fixed test passes repeatedly.
- The orb currently uses Node 26, while CI uses Node 22 → web verification
  uses NODE_OPTIONS=--no-experimental-webstorage so jsdom provides storage.
  Do not commit an unrelated environment workaround.

## Migration Plan

No database migration is planned. The owner authorised related small PRs,
independent review and merging once CI passes on 28-Oct-2026. Archive this
change once every task is verified. This does not authorise manually
triggering deployments or changing the trial's data.

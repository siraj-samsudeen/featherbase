## Why

A Team Leader who finds a subcategory that isn't theirs has to say which section it belongs in, and they guess wrongly: a Girls subcategory went to a Boys section. Once sent, it can't be taken back (#1175). Siraj and RB agreed a new design on 10-Nov-2026.

## What Changes

- "Not mine" asks only to take a subcategory out of their section. Approved, it is in no section at that store, and the master data team sees it on a list until someone adds it.
- "Add subcategories" browses division, sub-division and category, and asks for several at once, each showing who holds it now.
- The maker can withdraw a pending proposal until it is decided.
- An addition of a subcategory held elsewhere is shown to the approver as a move. Either Team Leader's manager may decide it, and may put it in another section instead.
- The list of subcategories shows their division, sub-division and category, once when they share one, else as groups.
- The old "pick where it goes" flow goes. Proposals already made that way stay decidable.

## Capabilities

### Modified Capabilities

- `my-sections`: removal without a destination, adding by browsing, undo, moves seen by both managers, the master data team's list.
- `workflow-and-approvals`: a maker withdraws a pending proposal; a proposal can end a row with nothing in its place; an approver can apply a different value than proposed.

## Impact

- `apps/server/src/change-proposals.ts`, `packages/shared/src/runtime-actions.ts`, migration 0159.
- `client-apps/jeyarama/dash`: `my-sections.ts`, `sections-page.tsx`, the manifest (Subcategory's levels are read).

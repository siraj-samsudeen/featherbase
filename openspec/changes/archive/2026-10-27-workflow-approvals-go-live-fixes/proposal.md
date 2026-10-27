# Proposal

## Why

Two workflow gaps would bite on the first day of go-live. One action with a condition that can't be worked out stops every action on the row from showing, so a single typo in one condition blocks every approval under that workflow. And a row created straight into a state that waits on an approver tells nobody, so the request sits unseen.

## What Changes

- An action whose condition can't be worked out is hidden on its own; the row's other actions still show. Taking that action is still refused, as today.
- A row created in a state that waits on someone's decision emails the people who can act on it, exactly as moving a row into that state does (owner decision, 26-Sep-2026).

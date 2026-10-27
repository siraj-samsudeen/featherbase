# Design

## Context

The Columns editor places a wide table directly in a card. On a phone, its fixed-width inputs expand the Admin content canvas instead of containing the table's overflow.

## Goals / Non-Goals

**Goals:**

- Contain the table's horizontal overflow in the card, using the existing Admin table pattern.
- Prove the page stays within a 375px viewport and the Rename control can be brought into view and used.

**Non-Goals:**

- Change the rename operation, table metadata, Admin layout, or another screen.
- Redesign or shrink the table's desktop columns.

## Decisions

- Wrap the existing table in an `overflow-x-auto` element inside its existing card. This matches other Admin data tables and preserves their desktop layout; reducing individual cells would create a new narrow-screen design and risks changing usability.
- Add a focused Playwright test at 375px. It will check the Admin canvas has no horizontal overflow, the table wrapper has overflow available, and use the existing rename control after scrolling it into view. The existing Session fixture supplies navigation; measurements and programmatic inner scrolling stay in a named step because they are unsupported Session actions.

## Risks / Trade-offs

- [The test could only assert visibility after automatic scrolling] → Assert the inner wrapper owns overflow before bringing Rename into view, then click Rename without submitting a schema mutation.
- [A wrapper could affect desktop width] → Inspect the existing desktop route and retain the table's current width classes.

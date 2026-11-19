## Why

Finding "which sections sell women's ethnic wear in Bayside" means building Linked to filters one
at a time, with no view of what the other choices would leave. Siraj chose option C of #1289 on
19-Nov-2026, the QlikView model: click a value and every list and count updates at once. Boards
A (live), B (Live Cells) and C (Connections) in `docs/design/mockups/look-and-relationships.html`
are the target, items 19–29 of the spec checklist v3.

## What Changes

- **Click To Narrow** (wave 1, board A): a panel left of every admin list, with one list of values
  per table the list's rows reach (its links up to three steps, its own rows, the far side of a
  link table, its Choice columns). Each value has a bar and a live count under every other list's
  picks. Picked values are green, ruled-out ones grey at 0. A linked list ends with "Not linked to
  any <Table>". Top 6 values, Show all in a scroll box, Find in <Table> for long lists. Picks read
  as green chips, with Clear All and Save As View. The panel hides, remembered per person and
  Table; on a phone it is a Narrow By sheet.
- A tick is the #1276 **Linked to** filter (or `in` / `is blank` for own rows and Choice values),
  so the address, saved views and chips keep working. There is no second filter model.
- The server counts every list in one statement, `GET /api/table/<Table>:narrow`, with every
  step joined only through rows the viewer may read.
- Later waves of this change: the ▾ value menu, count previews and "+ Linked count" (board B);
  Connections (board C); the drill panel.

## Capabilities

### Modified Capabilities

- `list-view`: Click To Narrow.

## Impact

- `apps/server/src/narrow-counts.ts`, `actions/collection-narrow.ts`.
- `apps/web`: `lib/narrow.ts`, `components/NarrowPanel.tsx`, `ListView.tsx`, `ListFilters.tsx`.
- `packages/shop-floor`: `FilterChip`'s picked tone; the panel's tokens in `styles.css`.

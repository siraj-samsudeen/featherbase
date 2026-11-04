## Why

**People and access → Waiting for access** is a one-off table, not Featherbase's standard list (#835). It can't
sort, filter, choose columns or select rows the way every other list can. A person without a full name shows as
their internal id (`psn_…`), which tells an administrator nothing about who is waiting. The page shows only the
email domain (#429). The owner decided on 04-Nov-2026 that it shows the full address instead, because only
System Managers see it and they already see addresses on the Person form.

## What Changes

- Waiting for access is the standard Person list, narrowed to people who are enabled, not built in, not merged
  away and hold no role of their own. It sorts, filters, picks columns, selects and opens rows like any list,
  newest first by default, and the person's own filters live in the page address.
- The list shows each person's full email address. Someone without a name is identified by it.
- The menu still shows how many are waiting, counted on the server as the same group.
- **Arrived by**, **First sign-in** and **Last sign-in** leave the page, because they aren't Person columns. How
  someone signed in stays on their Person form.
- The list language gains `not related`: rows holding none of a Sub-table's matching rows. This is how "holds no
  role of their own" is written.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: what a System Manager sees on the waiting list.

## Impact

Server: `query.ts` (the `not related` operator, Sub-table shape only), and the waiting list endpoint is removed
because the page reads the Person list. The count endpoint stays. Web: the Waiting for access page and route, and
`ListView` gains page-level props (base filters, title, subtitle, default order, empty text). No schema or
migration change.

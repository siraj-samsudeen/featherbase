## Why

A staff roster is loaded once, and nothing writes its status afterwards. On a live instance hundreds of people whose exit date has passed still show as current employees, because the roster link reads the status column but never writes it (#1286; client context data-warehouse#4812). The leaver check already knows from the warehouse who has left. On 18-Nov-2026 the owner approved keeping the roster's status in step from the same feed, by the same rule.

## What Changes

- When a roster names a left status (`left_status`), each roster run first moves rows between the current and left statuses by the leaver check's own rule, read from the same warehouse feed: left only on an exit date that has passed or an inactive mark; current again only when the record is active and on the payroll. Being off the payroll alone never moves anyone.
- A person the rule calls left whom attendance shows at work after their exit date (or, when only marked inactive, in the week before the feed's latest day) is held, not marked left: the HR record may be stale or wrong, and attendance is the table the feed's freshness is judged by.
- A left that the roster link itself set goes back to current as soon as the rule no longer says left, on the payroll or not, so a wrong feed it acted on is undone (owner, 18-Nov-2026). A left a person set, or changed afterwards, is theirs.
- The leaver check shares the attendance hold: such a person is not disabled, and Leavers Who Can Still Sign In lists them in a review-only section 6. Both jobs read the records, each one's last day at work and the feed day in one warehouse statement.
- Rows the feed does not have, and rows in any other status, are never touched. A stale or empty feed, or an unreadable warehouse, changes nothing.
- A run that would move more than one in twenty of the covered rows out of their status (at least ten, each direction on its own) changes none, is reported as refused and alerted. `cli roster:link --apply --accept-status <n>` lifts that limit for exactly the count a dry run showed, and `--accept-ends <n>` does the same for links ended.
- Each change is a normal save by the roster link, so it shows in the row's Activity and can be undone there. The statuses change before linking, so the same run ends a leaver's link and links a rejoiner.
- The leaver check's spec drops "not being on the latest payroll" as a basis, as #1271 already did in the code.
- Dash names `left_status: "Left"` in its instance settings.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: the roster link keeps the roster's status in step with the HR record; the leaver check's basis matches the code.

## Impact

- Platform: `roster-status.ts` (new), `roster-link.ts`, the `link_roster` job, `cli roster:link`, `leaver-check.ts` (the rule and feed reader shared, not copied), `delegated-login.ts` (`left_status`).
- Dash instance settings: `left_status`.

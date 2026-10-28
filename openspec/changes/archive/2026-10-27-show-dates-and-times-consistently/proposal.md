## Why

Three places showed dates in a way that misleads at go-live. A date-and-time in a list showed the UTC day and no time, so a store opening logged at 02:00 IST read as the day before. A row's history showed a date change as `2026-10-23T00:00:00.000Z`. The checklist run list showed older days as `2026-01-05`, and judged Today and Yesterday by the UTC calendar. Everyone should see a day as `23-Oct-2026`, and a moment on their own clock.

## What Changes

- A date-and-time value reads as the viewer's own day and time, such as `21-Oct-2024 02:00`; a date stays the stored day (#390).
- A row's history records a date change as the days themselves, and shows every changed value the way the rest of the Admin does (#421).
- The checklist run list heads older days like `05-Jan-2026`, and Today and Yesterday follow the reader's calendar (#539).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `list-view`: a date-and-time shows the viewer's day and time.
- `comments-and-history`: a date change in the history reads as days.
- `checklists`: runs are listed under readable day headings.

## Impact

Web formatting of read-only values (lists, read-only form fields, previews), the activity timeline and the checklist run list. On the server, the change history records a Date change as the day. No schema, migration, endpoint or permission change; history already recorded as timestamps displays correctly as it is.

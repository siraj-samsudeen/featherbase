# Design

## Context

`parseWorkbook` read workbooks with SheetJS `cellDates: true` (xlsx 0.18.5). Under `TZ=Asia/Kolkata` that turns
serial 45586 (21-Oct-2024) into `2024-10-20T18:29:50Z`, which is 20-Oct 23:59:50 local. Two places then formatted the
day with `toISOString().slice(0, 10)`: the import preview and the shared Date schema.

## Decisions

- Read with `cellDates: false, cellNF: true`, and take the format section that applies to the value, as Excel does.
  If it is a date format, read the day from the serial by pure UTC arithmetic, never through a local Date:
  `SSF.parse_date_code` builds one and is wrong in zones that skipped a day. A date-only format gives `YYYY-MM-DD`
  text, because some zones have no local midnight on a day. A format that shows a time gives local date-time text,
  `YYYY-MM-DDTHH:MM:SS[.mmm]`, even at 00:00, because a Date at 05:30 in India is exactly UTC midnight and would read
  as a bare day. The time is the day fraction in whole milliseconds, carrying into the next day. Honour 1900 quirks
  and 1904-based workbooks (Codex, #388).
- One shared home for reading a Date's calendar day (`packages/shared/src/dates.ts`: `calendarDay`, `localIso`),
  used by the coercion, the Date schema and the preview. Never `toISOString()` for a day.

## Risks / Trade-offs

- [A CSV cell is no longer turned into a Date by SheetJS] → With `raw: true` CSV cells were already kept as text;
  the shared inference reads `YYYY-MM-DD` strings as dates. The import e2e specs pass unchanged.

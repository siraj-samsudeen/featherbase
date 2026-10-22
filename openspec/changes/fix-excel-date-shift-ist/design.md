# Design

## Context

`parseWorkbook` read workbooks with SheetJS `cellDates: true` (xlsx 0.18.5). Under `TZ=Asia/Kolkata` that turns
serial 45586 (21-Oct-2024) into `2024-10-20T18:29:50Z`, which is 20-Oct 23:59:50 local. Two places then formatted the
day with `toISOString().slice(0, 10)`: the import preview and the shared Date schema.

## Decisions

- Read with `cellDates: false, cellNF: true` and convert every numeric cell whose number format is a date
  (`SSF.is_date`) with `SSF.parse_date_code`, which gives y/m/d h:m:s with no timezone. Build a local Date from those
  parts, so a date-only cell is local midnight of the day the sheet shows, which is what the shared inference already
  reads as a Date. Honour 1904-based workbooks.
- One shared home for reading a Date's calendar day (`packages/shared/src/dates.ts`: `calendarDay`, `localIso`),
  used by the coercion, the Date schema and the preview. Never `toISOString()` for a day.

## Risks / Trade-offs

- [A CSV cell is no longer turned into a Date by SheetJS] → With `raw: true` CSV cells were already kept as text;
  the shared inference reads `YYYY-MM-DD` strings as dates. The import e2e specs pass unchanged.

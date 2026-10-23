# Design

## Context

`parseWorkbook` read workbooks with SheetJS `cellDates: true` (xlsx 0.18.5). Under `TZ=Asia/Kolkata` that turns
serial 45586 (21-Oct-2024) into `2024-10-20T18:29:50Z`, which is 20-Oct 23:59:50 local. Two places then formatted the
day with `toISOString().slice(0, 10)`: the import preview and the shared Date schema.

## Decisions

- **Serials become text, never a Date.** Read with `cellDates: false, cellNF: true`. Pick the format section SheetJS
  renders: a port of its `choose_fmt`, with conditions on the first two sections, then the sign. Elapsed-time
  formats (`[h]`, `[m]`, `[s]`) are durations, so their numbers are kept. A serial outside Excel's date range
  (below 0, or past 31-Dec-9999: 2958465 in the 1900 system, 2957003 in 1904) stays a number. If the format is a
  date format:
  - The day comes from `serialDay`: pure UTC arithmetic on the serial, never a local Date (`SSF.parse_date_code`
    builds one, and it is wrong in zones that skipped a day). It honours the 1900 quirks (serial 0 is 31-Dec-1899,
    60 is the fictitious 29-Feb-1900) and 1904-based workbooks.
  - A date-only format gives `YYYY-MM-DD` text. A local Date would not do, because some zones have no local
    midnight on a day.
  - A format that shows a time gives wall-clock text, `YYYY-MM-DDTHH:MM:SS[.mmm]`, even at 00:00, because a Date at
    05:30 in India is exactly UTC midnight and would read as a bare day. The time is the day fraction in whole
    milliseconds, carrying into the next day. Escaped, quoted, spacing (`_x`) and fill (`*x`) characters are never
    read as time codes.
- **Wall time goes on the wire as an instant.** `coerceRows` passes a Datetime with no zone through
  `wallTimeToInstant`. It reads the text on the importing browser's clock and sends `toISOString()`; a bare day is
  local midnight. A `+HH:MM` suffix was rejected: IST's 1899 local mean time is `+05:21:10`, which `Date.parse`
  cannot read. Zoned text is sent unchanged. Daylight-saving edges follow JavaScript Date: a time in a
  spring-forward gap moves forward by the gap, and an ambiguous fall-back time takes its first occurrence.
  `coerceRows` runs only in the browser (ImportWizard, TableBuilder, TableMerge).
- **Validation refuses days PostgreSQL cannot hold.** The Date and Datetime schemas share `isCalendarDay`, which
  refuses 30-Feb, month 13, Excel's 29-Feb-1900 and year 0. A dry run reports these instead of the write failing.
  `wallTimeToInstant` leaves such text as typed, because V8 would roll it into March.
- **One shared home:** `packages/shared/src/dates.ts` (`calendarDay`, `localIso`, `isCalendarDay`,
  `wallTimeToInstant`), used by the coercion, the schemas and the preview. A day is never formatted through
  `toISOString()`.

## Risks / Trade-offs

- [Bare CSV date-time text changes meaning] → it is now the importer's local time rather than the server's UTC. This
  matches how the form's date-time input already reads a typed value.
- [Rows already imported keep their shift] → out of scope here; correcting them is #389.
- [Datetime list cells still show the UTC day] → `formatDate` takes the stored value's leading day, so IST values
  between 00:00 and 05:29 show the previous day. Fixing that is #390.

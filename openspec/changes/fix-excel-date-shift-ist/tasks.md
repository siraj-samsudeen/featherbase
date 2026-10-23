# Tasks

## 1. Dates keep their day

- [x] 1.1 Failing tests under `TZ=Asia/Kolkata`: a real xlsx buffer with 21-Oct-2024, 29-Feb-2024, 31-Jan-2024,
  31-Dec-2024 and 01-Jan-2025 reads as that day; 31-Dec-2024 23:59:58 keeps its time; coerced rows
  and the import preview show the sheet's day; a non-date number stays a number; the shared Date schema keeps a
  local-midnight Date's day.
- [x] 1.2 Parser reads serials with their number format, picks the section SheetJS renders, and turns date cells into
  text through `serialDay` (`YYYY-MM-DD`, or wall-clock `YYYY-MM-DDTHH:MM:SS[.mmm]` when the format shows a time);
  out-of-range serials stay numbers. `coerceRows` sends a zone-free Datetime as an instant via `wallTimeToInstant`.
  The Date and Datetime schemas refuse impossible days through `isCalendarDay`. Shared `calendarDay`/`localIso`
  replace every `toISOString()` day in the import path.
- [x] 1.3 Web and shared suites, server import tests, web and server typecheck, import e2e specs locally in IST,
  `pnpm check:specs`, `git diff --check`.

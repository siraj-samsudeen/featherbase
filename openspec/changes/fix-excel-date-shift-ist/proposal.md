# Proposal

## Why

Someone in India who imports an Excel file gets every date stored one day early: a sheet that says 21-Oct-2024
saves 20-Oct-2024. The Suppliers import on featherbase-dev showed it on 12-Oct-2026 (#387).

## What Changes

- Excel date cells are read as the calendar day (and time) the sheet shows, whatever the browser's timezone.
- A Datetime with no timezone (an Excel time cell, CSV text such as `2024-10-21 12:00`, or a bare day typed into a
  Datetime column) is read on the importing browser's clock and sent as the instant it names.
- The import preview and the Date and Datetime validation read a day without moving it across timezones, and
  refuse days PostgreSQL cannot store.
- Tests run under India Standard Time, plus São Paulo, Samoa and New York for daylight-saving and skipped-day edges.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This fixes the spreadsheet import's implementation of dates; what the import promises does not change.

## Impact

The web import's workbook parser, the import preview, the shared row coercion, and the shared Date and Datetime
validation. No API or dependency changes.

**Data shape change:** a Datetime value without a timezone, including bare CSV date-time text, is now read on the
importing browser's clock. Before, it went to the server unconverted, and PostgreSQL read it in the server session's
timezone (UTC), so an IST noon came back as 17:30.

Rows imported before this change keep their shifted values. Correcting them is #389. Datetime list cells showing the
UTC day is #390.

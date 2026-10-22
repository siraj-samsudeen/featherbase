# Proposal

## Why

Someone in India who imports an Excel file gets every date stored one day early: a sheet that says 21-Oct-2024
saves 20-Oct-2024. The Suppliers import on featherbase-dev showed it on 12-Oct-2026 (#387).

## What Changes

- Excel date cells are read as the calendar day (and time) the sheet shows, whatever the browser's timezone.
- The import preview and Date validation read a date's day without moving it across timezones.
- Tests run under India Standard Time for dates around midnight and at month and year ends.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This fixes the spreadsheet import's implementation of dates; what the import promises does not change.

## Impact

The web import's workbook parser, the import preview, and the shared Date validation. No API, data shape or
dependency changes.

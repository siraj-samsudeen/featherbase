## Why

A reader whose connection dropped saw the same "This report couldn't open" as one whose report MotherDuck refused, so they couldn't tell whether to check their network or ask for help. Whoever runs Dash couldn't tell which report a failure was (#1391, approved by Siraj on 21-Nov-2026).

## What Changes

- When a request gets no answer at all (it fails on the way, or runs out of time), the page says Dash couldn't be reached and asks the reader to check their connection, with Try Again.
- When the server answers with a refusal or a MotherDuck error, the page still says the report couldn't open, with Try Again.
- A failed Dive's log line names the report, its Dive and MotherDuck's answer, cut short, with no secret.

## Capabilities

### New Capabilities

### Modified Capabilities

- `dash-reports`: a report that can't open tells a lost connection apart from a report that couldn't open.

## Impact

Dash 0.13.46 (step `dive_failure_detail`, no Table change).

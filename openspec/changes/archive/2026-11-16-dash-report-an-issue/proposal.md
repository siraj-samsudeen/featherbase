## Why

A person reading a Dash report who sees something wrong (a figure, missing stock, an item run out, a target too high or too low) has no way to say so from the report; going to Tickets means retyping which report, store and item (#1240).

## What Changes

- Every Dash report offers "Report an issue": a side panel with five quick picks, an optional item and a note. The ticket carries, untyped, the report and a link back to the view, the store and month on show, the filters the Dive reports, the reader's stores and sections, their job, and the time.
- The ticket is raised in Tickets by the reader themselves, as a built-in "Feedback on a report", whose details Tickets checks and keeps private to the raiser and support. It starts New with nobody assigned.
- The reader sees a link to their ticket, and their open feedback on that report.

## Capabilities

### Modified Capabilities

- `dash-reports`: a report offers "Report an issue".
- `tickets-workspace`: Tickets keeps feedback on a report, raised from the report.

## Impact

- Dash 0.13.12 (read `feedback_context`), Tickets 0.2.17 (kind `report_feedback`, read `about_report`); empty upgrade steps, no Table and no grant.

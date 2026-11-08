## Why

Jeyarama Group's Task Management BRD (v1.0) makes configurable escalation a pass gate and asks for
issues with severity, separate response, resolution and verification clocks, a reminder at 75% of
the fix time and escalation at breach (ISS01, ISS02, ISS04, ISS05; UAT02, UAT07, UAT10). Tasker
has tasks with due dates but no issues, clocks or escalation. The owner approved the mockups and
an 11-point checklist on 07-Nov-2026.

## What Changes

- A Tasker member raises an issue with:
  - category, severity, store, when it happened and the asset or area
  - impact, containment and an optional photo
  - the function that owns it
  Each issue has one owner, and corrective tasks link to it.
- SLA rules give each severity a response time, a fix time and a clock that runs either round the
  clock or in store hours. A category can override a severity's row. Built-in defaults apply
  until the business sets its own.
- Each store has opening hours, 09:00–22:00 by default and editable. A store-hours clock counts
  only those hours, read in IST.
- There are three separate clocks: response, resolution and verification. Each issue shows the
  total time since it was raised and the time on the clock.
- A job checks open issues every minute:
  - When an owner is assigned, the owner gets a notice.
  - At 75% of the fix time, the owner gets a reminder.
  - At breach, the store manager and the function head get a notice.
  - A Critical issue goes to the director after a further time.
  Each step happens once and is logged on the issue. Notices appear in Tasker.
- An issue with no owner, or with no one to escalate to, appears under "Needs an owner".
- "Waiting for vendor" pauses the clock only once the store manager approves it, with a reason
  and a next review date.
- An issue closes the way a verified task does. A breach stays recorded after closure, and
  reopening keeps the time already used.

Not included:
- routing by entity or department hierarchy
- root-cause investigation
- source-data corrections
- StyleHR
- email or WhatsApp delivery

## Capabilities

### New Capabilities

- `tasker-issues`: issues, SLA clocks, escalation, pausing and verified closure of issues.

### Modified Capabilities

None.

## Impact

- Tasker 3.3.0, with an upgrade step from 3.2.0. The step adds:
  - the issue, SLA rule and function head Tables
  - store managers and store hours
  - a link from a task to its issue
  - the escalation job
- The development sample data gains issues in each clock state.

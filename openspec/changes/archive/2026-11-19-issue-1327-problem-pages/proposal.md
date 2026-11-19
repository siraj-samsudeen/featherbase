## Why

Errors were drawn about ten different ways, mostly with no way back (the UI consistency audit, F07, #1327). A missing record was one red line ("Cannot load Site NOPE"), and a missing report was red text in a card. An address outside the Admin got the router's own "Not Found". And a report reader who opened an Admin link was moved to the report with no word, losing the address (F08).

## What Changes

- One shared page for what a screen can't show: Not found, No access, or Couldn't open. Each says in plain words what happened and gives one way forward: back to the list, the Admin home, Featherbase, or Try again.
- It is used for a missing or refused record, Table, script report and dashboard, for the Portal's refusals, and for any address that matches nothing.
- A report reader at an Admin address is told the Admin isn't part of their account and offered their report. The address stays, and no access request is sent: their place is an app, so it would tell nobody (#955).

## Capabilities

### New Capabilities

### Modified Capabilities

- `admin-ui-feedback`: a screen that can't show what was asked says why, with one way forward.
- `permissions-and-roles`: a report-only person at an administration address is told, not moved.

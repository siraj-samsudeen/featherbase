## Why

The Waiting for access list counts everyone who signed in with no role of their own (#429, #835). Once System
Settings gives Tasker Member and Tickets Requester to everyone who signs in (#923), that list fills with people who
already use Tasker and never asked for anything else, and every new sign-in mails the System Managers (#955).

Siraj settled it on 05-Nov-2026: waiting is per app. A person waits for an app only after opening it without access.

## What Changes

- Opening an app (or Featherbase itself) without access records an access request for that person and app, and the
  page says "You don't have access to <App> yet. An admin has been told." Opening it is the request: there is no
  Request access button. A person is never listed for an app they never opened.
- The Waiting for access list lists access requests, one row per person and app, newest first, with an App column
  and an App filter. A request leaves the list once that person can open that app.
- The alert email goes out when a request is first made, once per person and app, not at sign-in. A request still
  waiting a day later is sent again once, in one reminder email listing every such request.
- Both emails go to the System Managers. Who approves each app is a separate decision with Siraj.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: who counts as waiting for access, and when System Managers are told.

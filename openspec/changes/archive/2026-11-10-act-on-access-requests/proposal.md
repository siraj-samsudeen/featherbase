## Why

The Waiting for access page only listed requests. To give access, a System Manager had to open the Person, edit Roles by hand, then give Dash reports on Dash's own page. They had no way to decline a request or to clear a false alarm. Siraj asked on 10-Nov-2026 to approve, with roles and reports, from the request itself (#1173).

## What Changes

- A click on a waiting request opens a drawer beside the list. It shows who the person is, how they sign in, their job as installed apps describe it, and what they asked for.
- **Approve** gives roles through the Person save, and each app's access through the action the app's manifest names under `access.grant`. Dash declares `grant_options` and `give_report`.
- **Decline** needs a reason. The request stays, marked declined, and the person is told it was declined, never the reason. **Dismiss** deletes it.
- Every decision is one activity log row. No mail is sent.

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: a System Manager approves, declines or dismisses a waiting request.

## Impact

- `apps/server/src/access-decisions.ts`, `waiting-for-access.ts`, migration 0158, and the manifest's `access.grant`.
- `apps/web`: `AccessRequestDrawer` and the Waiting for access page; ListView gains page filters, a row panel and extra columns.
- Dash 0.12.7: the `grant_options` read.

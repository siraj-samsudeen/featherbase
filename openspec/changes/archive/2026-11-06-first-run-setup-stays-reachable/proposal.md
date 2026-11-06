## Why

On a fresh production install the Administrator signed in with "A System Manager with an email address" failing and nothing said so (#1003). The sign-in offer is only made on a password sign-in with no return path, and #758 stopped this check counting towards the health banner. Once missed, only typing the address reached setup (#1004), and that address said `people` while the Table is Person (#1005).

## What Changes

- A banner for the Administrator on every Admin page but the setup screen, for as long as the check fails, with a link to setup. It has no dismiss control.
- Instance health's failing check links to setup for the Administrator and to the Person table for anyone else.
- The Admin sidebar offers setup to the Administrator while the check fails.
- The setup screen's address becomes `/featherbase/admin/setup/person`, the old one redirects, and its label is "Set up administrators" everywhere.

## Capabilities

### Modified Capabilities

- `instance-health`: how first-run setup stays reachable.

## Impact

- `apps/web` and the page catalogue in `packages/shared`. No server logic, schema or app version change.

# Proposal

## Why

Google sign-in needs a privacy notice at a public address on the instance's own
domain. Featherbase's code is public, so an organisation's own wording (and its
contact details) must not live in it (#401, replacing #393).

## What Changes

- An administrator sets the instance's privacy notice as Markdown in System
  Settings, either in the form or from a reviewed file with
  `cli settings:set privacy_notice --stdin`.
- A public privacy page shows that notice to anyone, signed in or not, as a
  plain readable page that works on a phone and in dark mode. Raw HTML in the
  notice is shown as text, never run.
- With no notice set, the page does not exist.

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: adds the public privacy notice.

## Impact

- New System Settings field (migration 0105), the `/privacy` route and its
  renderer in `apps/server`, a `settings:set` CLI command, and one new server
  dependency (`markdown-it`, raw HTML off).
- `docs/DEPLOY.md` says where an instance's text lives and how to apply it.

# Proposal

## Why

Three small gaps an operator or a user cannot see until something goes wrong, closed before go-live.

- Changing the Administrator's password in the deployment settings does not change the live password. A half-done rotation goes unnoticed: the old password keeps working while the setting and the vault say otherwise (#467).
- An uploaded file declared as any kind of sound or video opens in place under whatever kind the uploader chose. Some of those kinds can be read by a browser as a web page (#562).
- The browser session cookie is not marked secure on an instance reached over a secure address, so a browser could send it over a plain connection (#353).

## What Changes

- The release check, and its rehearsal on the command line, warn when the configured Administrator password is set but is not the live one. Neither value is ever printed, and the release still goes ahead.
- Sound and video open in place only for the common formats (MP3, Ogg, WAV, WebM, MP4, QuickTime). Any other declared sound or video kind downloads.
- The session cookie is marked secure whenever the instance is reached over a secure address, by the same rule the Google sign-in cookies already follow. A plain local address keeps working.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `running-an-instance`: a release warns when the configured Administrator password is not the live one.
- `files-and-sharing`: only common sound and video formats open in place.
- `sign-in-and-accounts`: the session is sent only over a secure connection on a secure address.

## Impact

Platform only. The release preflight (and so `cli boot-check`), file serving and the session cookie. No migration, no new setting.

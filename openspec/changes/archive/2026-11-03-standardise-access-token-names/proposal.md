## Why

People need recognisable automation credentials without typing a name each time or replacing working secrets just to rename them. #853 also brings this page into the platform's standard list and dialog presentation.

## What Changes

- Owner-approved direction A: separate Tokens and Service accounts tabs, shared list primitives and dialog-based creation rather than an always-open form.
- Suggest an editable owner-name-plus-number token label, counting all that owner's tokens, including expired and revoked ones. Preserve deliberate edits and clearing.
- Allow guarded display-name changes without changing identity, credentials or access.
- Preserve all current issue, revoke, create, enable and disable workflows.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `access-tokens`: editable suggested names and guarded renaming.

## Impact

AccessTokens page, auth and service-account ownership modules and their HTTP routes/tests. No migrations, dependencies, counter or security-policy changes. #852 access summaries/expiry prompts and #737 command discovery remain separate.

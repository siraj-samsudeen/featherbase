## Why

On Access tokens, Revoke (a token) and Disable (a service account) acted on one click, with no confirmation, while Featherbase's other destructive actions ask first (the UI consistency audit, finding F37, #1323). One stray click stopped an integration.

## What Changes

- Revoke asks first: "Revoke token “<label>”?", saying anything using it stops working at once and that this cannot be undone.
- Disable asks first: "Disable service account “<name>”?", saying how many active tokens stop working until it is enabled again.
- Enable still acts at one click; it destroys nothing.
- Cancel has focus when the confirmation opens; Escape, Cancel or a click outside changes nothing. A failure keeps the confirmation open and says why.

## Capabilities

### New Capabilities

### Modified Capabilities

- `access-tokens`: Revoke and Disable ask for confirmation before acting.

## Why

Save sits only at the top of a form. Someone who adds a role to a Person further down the page can leave believing it was given, which leaves a person without access, or with access they should have lost, and nobody notices (#1009).

## What Changes

- Every editable form keeps a bar in view at the foot of the page while it has unsaved changes, saying "Unsaved changes" with a Save button.
- Leaving for another page with unsaved changes asks first, and reloading or closing the tab brings up the browser's own warning.

## Capabilities

### Modified Capabilities

- `core-forms`: unsaved changes stay in view and leaving asks first.

## Impact

- `apps/web/src/components/FormView.tsx` only. No server, schema or app version change.

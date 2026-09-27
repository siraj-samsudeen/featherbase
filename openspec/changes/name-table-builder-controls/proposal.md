# Proposal

## Why

People using assistive technology cannot identify several controls while building a table because those controls have no meaningful accessible name. Fixing one coherent table-building flow first gives users a complete, testable improvement without obscuring the other accessibility gaps tracked in #294.

## What Changes

- Give the table details, column controls, and row-naming controls meaningful accessible names without changing their visible appearance or behavior.
- Distinguish repeated controls by their column context so a user can tell which column each control affects.
- Add focused accessibility regression coverage for the table-building flow.
- Document the testing convention for preferring accessible names where it helps tests exercise the same interface assistive technology uses.
- Leave filters, import-only controls, assignments and tags, password-reset forms, and unrelated icon controls for later bounded changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `usable-on-any-device`: Make the existing clearly-named-controls promise concrete for the controls used to build a table and define its row names.

## Impact

The change is limited to the Admin UI's table builder, its column editors, the shared row-naming control, focused web tests, and testing guidance. It does not change server APIs, stored data, visual styling, or table-building behavior.

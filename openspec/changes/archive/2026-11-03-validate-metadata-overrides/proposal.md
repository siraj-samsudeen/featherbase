## Why

Metadata Overrides currently save even when a misspelled column or boolean value prevents the intended change. #739 asks for actionable refusals instead of silent ineffective customization.

## What Changes

- Refuse a named column that does not belong to the chosen Table, including on edits.
- Accept boolean setting text `true`, `false`, `1`, and `0`; refuse other text or missing values.
- Include the applicable permitted properties when refusing an unknown property.
- Preserve Table-level overrides, Custom Fields, system-written protections, and existing property allowlists.
- Expose those existing property definitions and value kinds through the shared package for #740's form to consume, without adding an endpoint or a second allowlist.

## Capabilities

### New Capabilities

- `metadata-override-validation`: actionable server validation when saving customizations.

### Modified Capabilities

None. The new capability adds validation detail to `tables-and-fields`' existing layered-adjustment and every-save/atomic-refusal promises; it does not replace those promises.

## Impact

Server controller, metadata coercion, shared property contract, existing server HTTP integration tests, and executable acceptance steps. No UI/schema redesign, new dependencies, production mutation, or historical-data rewrite. #740 owns form improvements independently and serializes boolean controls to text.

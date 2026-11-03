## Why

People encounter technical identifiers such as `client_id` and
`create_if_email_domain_allowed` in ordinary forms and lists. #826 asks for
readable platform wording without rewriting identifiers, saved choices, or
wording an app or instance has deliberately supplied.

## What Changes

- Curate platform-owned short column labels, retaining acronyms and existing
  intentional wording rather than applying a global capitalization rule.
- Use the shared label generator when a table or custom column omits its label;
  keep explicitly supplied labels unchanged.
- Separate technical Choice values from their human-facing presentation across
  forms, lists, filters, and other metadata-driven choice consumers using an
  optional authored `choice_labels` map. Unmapped values remain verbatim.
- Converge new and existing instances through an ordered migration limited to
  an enumerated set of known platform defaults. Keep custom labels, metadata
  overrides, and translations effective.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: readable default labels and human-facing choice wording,
  independent of canonical column names and saved choice values.

## Impact

Observed on `origin/main` at `39cdf97e`: omitted labels in `table-engine.ts` and
`custom-fields.ts` fall back to raw keys; the shared `prettifyLabel` already
serves imports and reflected sources. Choice definitions are newline-separated
strings. No separate label/value mapping exists in the shared, server, or web
column definitions inspected. Existing Metadata Overrides support `label` and
`choices`, not choice display labels. Translation catalogs are keyed by source
text, so changing a default label must also preserve its effective translation.

Expected implementation areas are shared label generation; server column
metadata, manifest validation and ordered migrations; and generic web choice
consumers, including the list-column projection and public-form projection.
Definition editors and CSV/data exports retain technical values where they
describe or transport stored data. No global CSS, navigation redesign, canonical
name changes, permission changes, or per-model forms are included.

#800 retains ActivityTimeline label/wrapping work; #821 retains route resolution;
#773 and #827 retain their primitives and command-result navigation. Client-app
and local app/filter changes remain with their current owners.

## Why

A mistyped table allowlist saves successfully but prevents connection later without explaining how to correct it (#780). Catch incomplete SQL identities when saving, without silently granting access to previously refused relations.

## What Changes

- Refuse incomplete SQL allowlist entries with engine-specific qualification guidance; CSV sources retain exact relative filenames.
- Explain qualification when an existing malformed allowlist refuses a connection, without rewriting it or changing which relations match.
- Preserve empty-list semantics, valid entries in stored mixed lists and the all-or-nothing connection rule.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`: understandable, explicit table allowlist identities.

## Impact

Data Source save validation and shared registry refusal messages, server HTTP tests and executable acceptance examples. No schema migration, driver/account changes, new engine, selected-database semantics, reflection naming or UI redesign.

## Authorization

At 2026-11-03 07:18 UTC the manager relayed owner all-worker review/defaults authorization under owner30min/no-routine-design and accepted recommended option B. Default-schema inference (option A) was rejected because defaults filter browsing and can span namespaces, and would activate or retarget stored grants. No merge, deployment or adversarial review authorized.

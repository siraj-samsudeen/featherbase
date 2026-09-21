## Why

Tasker's optional Project Markdown description exposed a platform gap: restart currently loads discovered code without checking the installed schema version. Production applications need explicit upgrades without resets or app-specific core migrations.

## What Changes

- Add package-owned, ordered additive migrations and immutable version/checksum identity.
- Add administrator Preview → Upgrade → Activate APIs, transactional metadata/DDL and fail-closed restart handling.
- Preserve operator-provided old artifacts and reject stale browser operations after an upgrade.
- Prove Tasker v1 rows, grants and preferences survive v2 and fresh v2 has equivalent schema.

## Capabilities

### New Capabilities

### Modified Capabilities

- `trusted-runtime-packages`: explicit versioned upgrade lifecycle, preview and recovery.

## Impact

Runtime loader, application lifecycle, installation ledger, manager APIs, request version admission, package fixtures and literal artifact proof. Single process only; no deployment, marketplace, arbitrary SQL, down migrations or Project editor UI.

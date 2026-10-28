## Why

Store managers need to maintain their store's data and delegate parts of that
responsibility without becoming platform administrators. The current protection
conflates business data that determines report coverage with platform access
configuration, while the emerging permission model is difficult to understand
without a concrete example.

## What Changes

- Record the decisions from #462 as behaviour requirements, with a proposed
  data model and a complete synthetic seed journey for an interactive prototype.
- Separate Platform Admin, App Admin and domain data administration; distinguish
  maintaining data, approving changes and delegating authority.
- Give create, read and update independent column selections. Attach row scope
  to each role assignment; preserve each grant's boundaries when combining them.
- Support dated organisational membership, bounded delegation, continuity across
  manager handovers, approval conflicts and job-derived authority checks.
- **BREAKING:** remove `decides_scope` protection for app tables, replacing it
  with the complete authorisation model; retain separate platform protections.
- **BREAKING:** rename System Manager to Platform Admin and replace operation
  flags with per-operation permission records when implementing the change.

## Capabilities

### New Capabilities

None. This extends the existing permission and approval capabilities.

### Modified Capabilities

- `permissions-and-roles`: operation-specific details, scoped grants, bounded
  delegation, job-derived powers and the distinction between platform and domain
  administration.
- `workflow-and-approvals`: held edits, composition of approval requirements,
  current authority checks and fresh review after conflicting edits.

## Impact

This PR contains planning artifacts only. It does not change running permissions,
rename stored roles, migrate data or implement the prototype. The next deliverable
is a disposable HTML prototype based on these artifacts, followed by owner review.

Implementation will affect metadata, permission evaluation, app role bindings,
save paths, imports, workflows, preflight and their tests. Coordinate with #246
(scope), #392/#449 (jobs and organisation), #617 (app contracts), and #627
(approval rules). The design distinguishes agreed decisions from prototype
defaults and identifies production gates; it is not ready for automatic apply.

## Non-goals

No client data, deployment, production HR policy, generic SQL policy editor, or
claim that a browser-only prototype enforces server security.

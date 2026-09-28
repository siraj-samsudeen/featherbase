# Reliable editing

## Purpose

Keep people's task changes safe when sessions disagree, requests fail or a successful save loses its reply.

## ADDED Requirements

### Requirement: Reject stale Todo changes

Every Todo update or deletion MUST carry the documented proof of its observed version. Missing or stale proof MUST be rejected, including changes to different fields and values changed away and back. Two competing changes against one version MUST NOT both succeed. A conflict MUST preserve proposed input and show the latest saved values alongside it before deliberate retry. Acting on a deleted Todo MUST explain absence and retain recoverable draft text without recreating the record.

#### Scenario: Another session saved first
- **WHEN** A and B edit the same observed Todo and A commits first
- **THEN** B cannot silently overwrite A, can compare A's current values with B's proposal, and can deliberately retry against the current version.

### Requirement: Recover without losing intent

Known read/write failures MUST offer retry without a page reload, keeping drafts and last confirmed state. An uncertain create MUST retain its submitted values and request identity and reconcile before risking duplicate creation. New input can be locked until resolution or retained independently. Recovering an old submission MUST NOT discard a newer draft. Unrelated mutations can be blocked until reconciliation; if allowed, their success or failure MUST NOT erase another operation's recovery state. Finding an uncertain creation absent MUST leave a safe retry available. Repeated pending activation MUST NOT create duplicates.

These concurrency and uncertain-outcome workflows apply to Todos. Project operations must still report failure truthfully and preserve editable input; a separate Project concurrency workflow is not introduced here.

#### Scenario: A committed reply is lost
- **WHEN** First is saved but its reply is lost, and I attempt to complete an unrelated Todo
- **THEN** either the unrelated action is blocked or both outcomes remain recoverable, First is stored exactly once, and any permitted Second draft survives and can be saved separately.
- **WHEN** First never reached the server
- **THEN** status checking and retry can save it without retyping or duplication.

### Requirement: Preserve work through operational failures

Database unavailability MUST produce failed readiness and failed writes, not false success or fallback temporary storage. Service MUST recover when the database returns. Graceful and forced application shutdown MUST stop the actual listener. Immediate restart of the same build and database MUST preserve confirmed values and deletions; launchers and daemon-owned resource names MUST not leave a surviving instance or prevent restart.

#### Scenario: Restart after an outage
- **WHEN** the database becomes unavailable, returns, and the application is stopped and restarted
- **THEN** readiness reflects actual usability, rejected writes do not appear saved, and confirmed records and deletions survive.

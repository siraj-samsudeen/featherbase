## Why

Jeyarama Group's Task Management BRD (v1.0) makes "verified closure" a pass gate: a task that
someone else must check is not closed on the word of the person who did it. Today any Tasker
member can tick a task Done, nobody confirms they have seen an assignment, a due date can move
without a trace, and a task can be cancelled silently. The owner mapped the BRD to Tasker and
picked verified closure to build first.

## What Changes

- A shared task can have a verifier, a Tasker member other than the assignee. A project can set a
  default verifier for its new tasks.
- The assignee acknowledges a task given to them. Until then the task shows "Not acknowledged by
  <name>".
- A task with a verifier cannot be ticked Done. Its doer submits it with a note on what was done
  (and optionally a photo); it becomes "Submitted for verification". The verifier accepts it,
  which closes it as Done and records who verified it and when, or returns it with a reason,
  which puts it back In progress and counts the return.
- Nobody verifies a task they are assigned to or submitted. The server enforces this.
- A new "To verify" page lists the tasks waiting for the user's check.
- Moving a due date once it is set needs a reason. The first due date and the number of
  extensions are kept and shown.
- Cancelling a task needs a reason.
- Tasks without a verifier work as before.

Not included: escalation, routing by role, SLA clocks and limiting people to their location.

## Capabilities

### New Capabilities

- `tasker-verified-closure`: verifiers, acknowledgement, submit/accept/return, due date
  extensions with reasons, and cancelling with a reason.

### Modified Capabilities

None.

## Impact

- Tasker 3.2.0, with an upgrade step from 3.1.0. It adds the task's verification, extension and
  reason fields, a project's default verifier, and the "Submitted for verification" state.
  Existing assigned tasks count as acknowledged.
- The development sample data gains tasks waiting for verification, returned and extended.

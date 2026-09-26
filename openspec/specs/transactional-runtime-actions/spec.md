# Transactional Runtime Actions

## Purpose

An installed app can offer its own named actions — one command that does
several things at once, like moving a task and telling someone about it.
Featherbase guarantees that action either fully happens or doesn't happen at
all, that repeating the same request never runs it twice, and that the app
still answers only to what the calling person is actually allowed to do.

## Requirements

### Requirement: declared_app_actions_fail_closed

Only actions an app has explicitly declared, by name, SHALL run, and only
for someone with a recognized reason to use them. A stale request — from
someone signed out, or from after the app was disabled — SHALL be refused
before anything runs, and without revealing what a successful call would
have returned. Two different apps SHALL be able to declare an action with
the same name without either one reaching the other's.

#### Scenario: stale_or_unauthenticated_action_call

- **WHEN** someone with no session, or a signed-in person calling an action
  after its app was disabled, submits that action
- **THEN** it's refused before anything runs
- **AND** no result is returned, successful or otherwise

#### Scenario: two_applications_declare_same_action_name

- **WHEN** two installed apps each declare an action called "transform"
- **THEN** calling one only ever runs that app's own version

#### Scenario: absent_policy_requires_explicit_upgrade

- **WHEN** an app's already-installed version declared an action with no
  recognized rule for who may use it
- **THEN** calling that action is refused, and using it needs a reviewed,
  upgraded version that declares the rule
- **AND** the app's existing data and any results already recorded stay
  exactly as they were

### Requirement: action_helpers_preserve_caller_authority

An action SHALL only be able to do what the person calling it could already
do themselves — it SHALL NOT read or change anything outside what its app
owns and what the caller has permission for, and it SHALL NOT be handed
raw, unrestricted access to the database. Deleting through an action SHALL
be limited to rows the action itself is allowed to remove.

#### Scenario: malformed_action_payload_or_attempted_bypass

- **WHEN** an action rejects a request it doesn't recognize, or the request
  asks for something the action was never given access to
- **THEN** the action fails
- **AND** nothing it already changed survives

### Requirement: action_writes_and_replay_are_atomic

An action SHALL either fully succeed — every change it makes, together — or
leave nothing changed at all. Retrying the exact same request SHALL return
the exact same result without running the action's work again, but only
after checking the caller still has the same access they had the first
time; retrying with a changed request under the same retry marker SHALL be
refused rather than reusing the old answer. If access that a first, saved
result depended on is later removed, replaying that request SHALL refuse
rather than hand back what it once returned.

#### Scenario: asymmetric_multi_row_command_rolls_back

- **WHEN** an action changes one row, then a different one, then fails
- **THEN** neither change survives

#### Scenario: action_response_lost_and_caller_retries

- **WHEN** a request is submitted again after its response was lost,
  including after a restart
- **THEN** the same result comes back
- **AND** nothing the action does happens a second time

#### Scenario: narrowed_retry_cannot_disclose_old_scope

- **WHEN** the same retry marker is resubmitted with different details
- **THEN** it's refused rather than treated as a repeat of the original

#### Scenario: equivalent_store_order_replays_once

- **WHEN** the same request is resubmitted with the same retry marker and the
  same underlying access, just listed in a different order
- **THEN** the original result is returned once, without repeating the
  action's work

#### Scenario: queued_retry_sees_revocation

- **WHEN** access that a saved result depended on is removed, and that same
  request is submitted again
- **THEN** it's refused rather than returning the old result

### Requirement: Work that happens after an action commits doesn't repeat

An action may schedule follow-up work — such as a notification — to happen
right after its changes are saved. That follow-up SHALL run only once the
action's own changes are safely saved, never if the action failed, and a
failure in the follow-up itself SHALL NOT undo what was already saved or let
the action run again on retry. Disabling an app SHALL wait for any action
and its follow-up work already under way to finish first.

#### Scenario: A failed follow-up doesn't undo the action or repeat it

- **WHEN** an action's own changes are saved but its follow-up work then
  fails
- **THEN** the saved changes and the result already returned stay exactly
  as they were
- **AND** retrying does not run the follow-up work again

#### Scenario: Disabling waits for work already under way

- **WHEN** an app is disabled while one of its actions, or that action's
  follow-up work, is still running
- **THEN** disabling waits for it to finish
- **AND** any further call after that is refused

### Requirement: Deleting through an action respects the same delete guard

An action that deletes a row SHALL be refused under the same rule that
blocks deleting an installed app's row any other way — a comment, a
recorded edit, an attached file or an active share still on it, or an
out-of-date view of it — and SHALL tell the app what's holding the row back
so it can explain that to the person who asked. That refusal SHALL survive
being replayed later exactly as it was first given.

#### Scenario: An action explains why deletion was refused

- **WHEN** an action tries to delete a row that still has a comment and a
  file attached
- **THEN** the action is told what's still attached
- **AND** neither the row nor what's attached to it is deleted

#### Scenario: A replayed refusal stays the same

- **WHEN** that same refused request is submitted again later
- **THEN** it reports the same reason as before
- **AND** still deletes nothing

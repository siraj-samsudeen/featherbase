## ADDED Requirements

### Requirement: Private work has no administrator exception

An app MAY require membership and creator-only access to its work. When it does, administrative privileges and individual sharing grants SHALL NOT override those restrictions.

#### Scenario: An administrator searches for another person's draft

- **WHEN** an administrator searches or browses an app that keeps a member's draft private
- **THEN** the draft and its attached conversation are absent
- **AND** following a link to either refuses access

### Requirement: Membership changes apply immediately

Removing a person's required membership SHALL prevent subsequent reads, edits and change notifications for the protected work.

#### Scenario: Membership ends while work is open

- **WHEN** a person's membership is removed while they have shared work open
- **THEN** their next read or edit is refused and they receive no further change notifications for it

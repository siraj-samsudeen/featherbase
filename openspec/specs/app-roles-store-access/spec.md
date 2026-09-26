# App Roles and Store Access

## Purpose

An app can declare its own roles — who may read its data, and who may act on
it — and split its data by store, such as a shop or a warehouse, so a person
only ever sees the stores they've been assigned. Every check happens fresh,
from what's currently assigned, never from what a browser claims or what an
admin's normal authority would otherwise allow.

## Requirements

### Requirement: Roles decide who can read and who can act

An app SHALL declare which of its roles let someone read its data and which
let someone act on it, and Featherbase SHALL check the person's currently
assigned roles fresh on every read and every action — never from something
the browser sends, and never from being an administrator. If a role or a
store assignment is removed, the very next request SHALL reflect that,
without needing the person to sign out first.

#### Scenario: A reader can't act

- **WHEN** someone holding only an app's read role calls one of its actions,
  even while claiming to have the action role
- **THEN** the action is refused before anything runs

#### Scenario: Removing access takes effect on the next request

- **WHEN** someone's role or store assignment is removed while they're still
  signed in
- **THEN** their very next read or action reflects the change, refusing if
  it should

### Requirement: A person only sees the stores they're assigned to

When an app splits its data by store, a person SHALL only read or act on
rows belonging to a store they're currently assigned to — asking for even
one store outside that assignment SHALL refuse the entire request, not just
trim it down to what's allowed. Nothing about being an administrator, and no
missing assignment, SHALL be read as access to every store.

#### Scenario: One store outside the assignment refuses the whole request

- **WHEN** someone assigned to stores A and C asks for A and B together
- **THEN** the whole request is refused, even though A alone would have
  succeeded

#### Scenario: No assignment is not read as full access

- **WHEN** someone has no store assigned at all, or claims administrator
  authority without an explicit assignment
- **THEN** access is refused rather than treated as covering every store

### Requirement: An app can add its own extra check on top

An app MAY layer its own extra authorization on top of the role and store
checks — for instance, checking against its own business data before
letting something through. That extra check SHALL run only after the role
and store checks already passed, SHALL only ever narrow access further, and
its own failures SHALL fail closed exactly like a missing role or store
assignment does.

#### Scenario: The extra check can only narrow, never widen, access

- **WHEN** an app's own extra check passes for one combination of store and
  item but the request asks for a different, unapproved combination
- **THEN** it's refused even though the store-level check alone would have
  allowed it

### Requirement: Reading never changes data

A read an app offers SHALL never be able to create, change, or delete
anything — not even by accident. Reads, and the app's own actions, SHALL go
through the same up-to-date checks described above.

#### Scenario: A read handler has nothing to write with

- **WHEN** an app's read handler runs
- **THEN** it has no way to create, update, or delete any row

### Requirement: A refusal doesn't say what it's hiding, but it's recorded

When access is refused, Featherbase SHALL NOT reveal whether the thing being
asked for exists or what about it was out of reach. Every refusal SHALL
still be recorded for an admin to review — who asked, for what, and why it
was refused — without recording the request's private contents.

#### Scenario: A refusal is silent to the caller but visible to an admin

- **WHEN** a request is refused
- **THEN** the response reveals nothing about what was being protected
- **AND** an admin can see afterward that it was refused, and roughly why

### Requirement: A person can check which stores they can currently see

An app MAY let a person ask which stores they're currently assigned to, for
their own account only — never anyone else's, never with a store or role
they choose themselves. That answer SHALL reflect the assignment at that
exact moment, SHALL NOT be reused as proof of access for a later request,
and asking for it SHALL NOT run any of the app's own business logic.

#### Scenario: Checking your own access is exact and can't be reused

- **WHEN** someone checks their own store access, and then loses one of
  those stores in the same sitting
- **THEN** the first check reflects what they had at the time
- **AND** the next check reflects the loss
- **AND** neither check can be used later to regain access that was removed
